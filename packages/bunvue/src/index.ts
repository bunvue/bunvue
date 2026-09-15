import type { ViteDevServer } from 'vite'
import { resolveDevConfig, resolveProdConfig, type ResolvedConfig } from './config.ts'
import { RouteContext, mergeResponseHeaders } from './context.ts'
import { isCrossSiteRequest, resolveCsrf } from './csrf.ts'
import { VITE_ROUTE_PATHS, VITE_ROUTE_PREFIXES, type DevRuntime } from './dev.ts'
import { errorResponse } from './errors.ts'
import { createProdRuntime } from './prod.ts'
import { serializeRuntimeConfig } from './serialize.ts'
import { renderPage, type RenderDeps } from './render.ts'
import {
  READ_METHODS,
  buildAppRoutes,
  methodObject,
  normalizeParams,
  selectCandidate,
  type PatternGroup,
} from './routes.ts'
import { isResponseSignal } from './signal.ts'
import { createAssetsHandler, createPublicHandler, resolveStaticOptions } from './static.ts'
import type {
  ActionContext,
  BunvueOptions,
  BunRouteHandler,
  BunRoutesTable,
  Middleware,
  RequestIPProvider,
  RouteEntry,
  Runtime,
  RuntimeConfig,
  UserRoute,
} from './types.ts'

export { RouteContext } from './context.ts'
export { ResponseSignal, isResponseSignal } from './signal.ts'
export { createRoutes, expandRoute, expandRoutes, Routes } from './server.ts'
export { proxy, proxyRequest } from './proxy.ts'
export { createHtmlShells, removeHtmlModuleScripts, spliceShell } from './html.ts'
export * from './types.ts'

/** The handle returned by `Bun.serve`. */
export type BunServer = ReturnType<typeof Bun.serve>

export interface BunvueApp<S = undefined> {
  /** Spread into `Bun.serve({ routes })`. Populated by `ready()`. */
  routes: BunRoutesTable
  /** `Bun.serve` fallback for anything the routes table does not match. */
  fetch: (request: Request) => Promise<Response>
  serve: (options?: Record<string, unknown>) => BunServer
  ready: () => Promise<BunvueApp<S>>
  close: () => Promise<void>
  appRoutes: RouteEntry[]
  server: S
  /** The in-process Vite dev server, in dev mode only. */
  vite?: ViteDevServer
  onRoutesChanged: (callback: (routes: BunRoutesTable) => void) => void
}

/** Composes the middleware chain around a handler, once, at table build time. */
function withMiddleware<S>(
  handler: BunRouteHandler,
  middleware: Middleware<S>[],
  server: S,
): BunRouteHandler {
  if (middleware.length === 0) {
    return handler
  }
  return (request: Request, bunServer?: RequestIPProvider): Promise<Response> => {
    const dispatch = (index: number): Promise<Response> => {
      if (index === middleware.length) {
        return Promise.resolve(handler(request, bunServer))
      }
      return Promise.resolve(middleware[index](request, () => dispatch(index + 1), server))
    }
    return dispatch(0)
  }
}

function userRouteEntry<S>(
  route: UserRoute<S>,
  server: S,
): BunRouteHandler | Record<string, BunRouteHandler> {
  const handler: BunRouteHandler = (request: Request, bunServer?: RequestIPProvider) =>
    route.handler(request, server, bunServer)
  if (!route.method) {
    return handler
  }
  const methods = Array.isArray(route.method) ? route.method : [route.method]
  const entry: Record<string, BunRouteHandler> = {}
  for (const method of methods) {
    entry[method] = handler
  }
  return entry
}

function plainResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  })
}

/**
 * Runs a page action. A returned `Response`, a returned or thrown
 * `ResponseSignal`, or a `ctx.response` set along the way answers the request,
 * with `ctx.headers` merged in. Anything else is stored as `ctx.actionData`
 * and the page renders.
 */
async function runAction<S>(
  ctx: RouteContext<S>,
  route: RouteEntry,
): Promise<Response | undefined> {
  let result: unknown
  try {
    result = await route.action!(ctx as unknown as ActionContext<S>)
  } catch (error) {
    if (isResponseSignal(error)) {
      return mergeResponseHeaders(error.response, ctx.headers)
    }
    throw error
  }
  if (result instanceof Response) {
    return mergeResponseHeaders(result, ctx.headers)
  }
  if (ctx.response) {
    return mergeResponseHeaders(ctx.response, ctx.headers)
  }
  if (isResponseSignal(result)) {
    return mergeResponseHeaders(result.response, ctx.headers)
  }
  if (result !== undefined) {
    ctx.actionData = result
  }
  return undefined
}

export function createBunvue<S = undefined>(options: BunvueOptions<S>): BunvueApp<S> {
  const server = options.server as S
  const middleware = options.middleware ?? []
  const userRoutes = options.routes ?? []
  const staticOptions = resolveStaticOptions(options.static)
  // Validated and serialized once, here, rather than on every render: an app
  // that hands bunvue something JSON cannot represent finds out at startup.
  const runtimeConfig = options.runtimeConfig ?? ({} as RuntimeConfig)
  const runtimeConfigText = serializeRuntimeConfig(runtimeConfig)
  const routesChanged: Array<(routes: BunRoutesTable) => void> = []

  let config: ResolvedConfig | undefined
  let runtime: Runtime | undefined
  let devRuntime: DevRuntime | undefined
  let handle: BunServer | undefined
  let readyPromise: Promise<BunvueApp<S>> | undefined
  let publicFile: ((url: URL) => Promise<Response | null>) | null = null
  let tableReady = false

  const dev = options.dev ?? process.argv.includes('--dev')
  const timing = options.timing ?? process.env.BUNVUE_TIMING === '1'
  const csrf = resolveCsrf(options.csrf)

  const notFound = (request: Request, url: URL): Response =>
    options.onNotFound?.({ request, url, server }) ??
    new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })

  const handleError = async (error: unknown, request: Request): Promise<Response> => {
    devRuntime?.fixStacktrace(error)
    if (options.onError) {
      return await options.onError(error, request)
    }
    console.error(error)
    return errorResponse(error, dev)
  }

  const createAppHandler = (group: PatternGroup): BunRouteHandler => {
    const isCatchAll = group.pattern.endsWith('*')
    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url)
      try {
        if (devRuntime) {
          // Catch-all pages would otherwise swallow module and asset requests.
          if (await devRuntime.isViteRequest(url)) {
            return await devRuntime.proxy(request)
          }
          await devRuntime.refresh()
        }
        if (isCatchAll && publicFile) {
          const file = await publicFile(url)
          if (file) {
            return file
          }
        }
        const route = selectCandidate(group.candidates, url.hostname)
        if (!route || !runtime) {
          return notFound(request, url)
        }
        // In dev the table is rebuilt asynchronously, so a request can still
        // reach the handler of a page that was just deleted.
        if (devRuntime && !runtime.routes.includes(route)) {
          return notFound(request, url)
        }
        // Only a page with an action accepts anything but GET and HEAD, and
        // only from its own origin, checked before the body or context.ts.
        const mutation = request.method !== 'GET' && request.method !== 'HEAD'
        if (mutation) {
          if (!route.action) {
            return plainResponse(405, 'Method Not Allowed', { allow: READ_METHODS })
          }
          if (csrf && isCrossSiteRequest(request, url, csrf)) {
            return plainResponse(403, 'Forbidden')
          }
        }
        const params = normalizeParams(
          (request as Request & { params?: Record<string, string> }).params,
          group.wildcardParam,
          group.pattern,
          url.pathname,
        )
        const contextStart = performance.now()
        const ctx = await RouteContext.create<S>({
          request,
          url,
          params,
          server,
          route,
          runtimeConfig,
          contextInit: runtime.contextInit,
          onNotFound: options.onNotFound,
        })
        if (timing) {
          ctx.mark('context', contextStart)
        }
        if (mutation) {
          if (ctx.response) {
            return mergeResponseHeaders(ctx.response, ctx.headers)
          }
          const actionStart = performance.now()
          const answered = await runAction(ctx, route)
          if (timing) {
            ctx.mark('action', actionStart)
          }
          if (answered) {
            return answered
          }
        }
        const shells = runtime.shellsFor(route.id, url)
        const deps: RenderDeps = {
          create: runtime.create,
          routes: runtime.routes,
          routeMap: runtime.routeMap,
          routesPayload: runtime.routesPayload,
          runtimeConfig: runtimeConfigText,
          shells: shells instanceof Promise ? await shells : shells,
          dev,
        }
        return await renderPage(ctx, deps)
      } catch (error) {
        return await handleError(error, request)
      }
    }
  }

  const fallback = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    try {
      // Everything Bun did not match is Vite's in dev: modules, public files,
      // the client bundle, the HMR ping. When Vite has nothing either and the
      // path looks like a page, answer with the app's own 404 so dev and prod
      // agree.
      if (devRuntime) {
        // Keeps the route table warm even for requests that never reach an
        // app handler.
        await devRuntime.refresh()
        const response = await devRuntime.proxy(request)
        if (response.status === 404 && !/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
          return notFound(request, url)
        }
        return response
      }
      if (publicFile) {
        const file = await publicFile(url)
        if (file) {
          return file
        }
      }
      return notFound(request, url)
    } catch (error) {
      return await handleError(error, request)
    }
  }

  /**
   * (Re)builds the whole Bun routes table: app routes first so a user route
   * may override a colliding path, then the mode-specific asset or Vite
   * routes, then the user routes.
   */
  const buildTable = (): BunRoutesTable => {
    const table: BunRoutesTable = {}
    if (!runtime) {
      return table
    }

    const appTable = buildAppRoutes(runtime.routes, (group) =>
      withMiddleware(createAppHandler(group), middleware, server),
    )
    Object.assign(table, appTable)

    if (devRuntime) {
      // Vite's own namespaces. These prefixes outrank an app catch-all in
      // Bun's route precedence, so module requests never reach the renderer.
      const toVite = withMiddleware(
        (request: Request) => devRuntime!.proxy(request),
        middleware,
        server,
      )
      for (const prefix of VITE_ROUTE_PREFIXES) {
        table[`${prefix}/*`] = toVite
      }
      for (const path of VITE_ROUTE_PATHS) {
        table[path] = toVite
      }
    } else if (config) {
      // Hashed build assets
      const basePrefix = config.base.endsWith('/') ? config.base : `${config.base}/`
      const assetsPrefix = `${basePrefix}${config.assetsDir}/`
      table[`${assetsPrefix}*`] = methodObject(
        withMiddleware(
          createAssetsHandler(runtime.assetsDirs, assetsPrefix, staticOptions),
          middleware,
          server,
        ),
      )
    }

    for (const route of userRoutes) {
      const entry = userRouteEntry(route, server)
      if (typeof entry === 'function') {
        table[route.path] = withMiddleware(entry, middleware, server)
      } else {
        const wrapped: Record<string, BunRouteHandler> = {}
        for (const [method, handler] of Object.entries(entry)) {
          wrapped[method] = withMiddleware(handler, middleware, server)
        }
        table[route.path] = wrapped
      }
    }

    return table
  }

  /** Publishes a fresh table and, in dev, hot-swaps it on the live server. */
  const applyTable = (table: BunRoutesTable): void => {
    app.routes = table
    app.appRoutes = runtime?.routes ?? []
    handle?.reload({ routes: table, fetch: app.fetch } as Parameters<BunServer['reload']>[0])
    for (const callback of routesChanged) {
      callback(table)
    }
  }

  const app: BunvueApp<S> = {
    routes: {},
    fetch: withMiddleware(fallback, middleware, server) as (request: Request) => Promise<Response>,
    appRoutes: [],
    server,
    serve(serveOptions: Record<string, unknown> = {}): BunServer {
      handle = Bun.serve({
        ...serveOptions,
        routes: app.routes,
        fetch: app.fetch,
      } as Parameters<typeof Bun.serve>[0])
      return handle
    },
    onRoutesChanged(callback: (routes: BunRoutesTable) => void): void {
      routesChanged.push(callback)
    },
    async close(): Promise<void> {
      await handle?.stop(true)
      handle = undefined
      await devRuntime?.close()
      devRuntime = undefined
      app.vite = undefined
    },
    ready(): Promise<BunvueApp<S>> {
      readyPromise ??= (async (): Promise<BunvueApp<S>> => {
        if (dev) {
          const devConfig = await resolveDevConfig(options as BunvueOptions<unknown>)
          const { createDevRuntime } = await import('./dev.ts')
          devRuntime = await createDevRuntime(devConfig, {
            vite: options.vite,
            onRoutesChanged: () => {
              // The first load happens before the table exists; `ready()`
              // builds it right after.
              if (tableReady) {
                applyTable(buildTable())
              }
            },
          })
          runtime = devRuntime
          app.vite = devRuntime.vite
        } else {
          config = await resolveProdConfig(options as BunvueOptions<unknown>)
          runtime = await createProdRuntime(config)
          publicFile = createPublicHandler(config.clientOutDir, config.base)
        }

        tableReady = true
        applyTable(buildTable())

        return app
      })()
      return readyPromise
    },
  }

  return app
}

export default createBunvue

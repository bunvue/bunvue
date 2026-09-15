import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serializeRoutes } from './serialize.ts'
import type { InlineConfig, ViteDevServer } from 'vite'
import type { ResolvedDevConfig } from './config.ts'
import { RouteContext } from './context.ts'
import { createHtmlShells, type HtmlShells } from './html.ts'
import { proxyRequest } from './proxy.ts'
import { safeResolve } from './static.ts'
import type {
  ContextInit,
  CreateFactory,
  Runtime,
  SerializedRoute,
  SSREntry,
  ViteDevOptions,
} from './types.ts'
import { expandRoutes, type Routes } from './server.ts'

/** Query parameters Vite uses to mark a module request. */
const VITE_QUERY_MARKERS = ['import', 'direct', 'raw', 'url', 't', 'html-proxy', 'worker_file']

/** Path prefixes Vite owns; Bun routes these straight through to Vite. */
export const VITE_ROUTE_PREFIXES = [
  '/@vite',
  '/@fs',
  '/@id',
  '/@react-refresh',
  '/node_modules',
  '/$app',
]

/** Exact paths Vite owns. */
export const VITE_ROUTE_PATHS = ['/__vite_ping', '/__open-in-editor']

const hasExtension = /\.[a-zA-Z0-9]+$/

/** Files whose addition or removal changes the route table: pages and actions. */
const ROUTE_FILE = /\.vue$|\.server\.(?:ts|js)$/

const WATCHER_LIMIT = /EMFILE|ENOSPC|too many open files|watchers/i

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g
/**
 * Vite hands the logger the bare word, the `[vite]` prefix and the `(ssr)`
 * tag are added when the line is printed. Both forms are matched so the
 * filter survives a change of shape.
 */
const VITE_CONNECTED = /^(?:\[vite\]\s*)?(?:\([^)]*\)\s*)?connected\.?$/

/**
 * The ssr environment's hot channel greets itself on stdout on every start.
 * It says nothing about the app, so it is the one message the dev logger
 * drops. Everything else, warnings included, passes through.
 */
export function isViteConnectedMessage(message: unknown): boolean {
  return typeof message === 'string' && VITE_CONNECTED.test(message.replace(ANSI, '').trim())
}

export interface DevRuntimeOptions {
  vite?: ViteDevOptions
  /**
   * Called after a refresh discovered a new routes array (a page was added or
   * removed, or the SSR entry re-evaluated). The app rebuilds its Bun routes
   * table and calls `server.reload()`.
   */
  onRoutesChanged?: () => void
}

export interface DevRuntime extends Runtime {
  vite: ViteDevServer
  /** Origin of the in-process Vite server, e.g. `http://127.0.0.1:5173`. */
  origin: string
  refresh: () => Promise<void>
  close: () => Promise<void>
  /** True when the URL should be handed to Vite instead of being rendered. */
  isViteRequest: (url: URL) => Promise<boolean>
  proxy: (request: Request) => Promise<Response>
  fixStacktrace: (error: unknown) => void
}

/** Grabs a free TCP port by binding to 0 and releasing it again. */
function freePort(hostname: string): number {
  const probe = Bun.serve({ port: 0, hostname, fetch: () => new Response(null, { status: 404 }) })
  const port = probe.port ?? 0
  probe.stop(true)
  if (!port) {
    throw new Error('bunvue: could not find a free port for the Vite dev server')
  }
  return port
}

function isWatcherLimitError(value: unknown): boolean {
  if (!value) {
    return false
  }
  const code = (value as { code?: string }).code
  if (code === 'EMFILE' || code === 'ENOSPC') {
    return true
  }
  const message = value instanceof Error ? value.message : String(value)
  return WATCHER_LIMIT.test(message) && /watch/i.test(message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value
  }
  return out
}

interface ModuleRunnerLike {
  import: (id: string) => Promise<unknown>
  clearCache?: () => void
  close?: () => Promise<void> | void
}

/**
 * How long to let Vite finish invalidating its module graph after a file
 * event before re-importing the SSR entry.
 */
const SETTLE_MS = 40

/**
 * Starts the in-process Vite dev server and returns a runtime that re-imports
 * the SSR entry through Vite's module runner on every request, so HMR updates
 * are picked up without restarting Bun.
 */
export async function createDevRuntime(
  config: ResolvedDevConfig,
  options: DevRuntimeOptions = {},
): Promise<DevRuntime> {
  const vite = await import('vite')
  const host = options.vite?.host ?? '127.0.0.1'
  const port = options.vite?.port ?? freePort('127.0.0.1')
  const extra = (options.vite?.config ?? {}) as Record<string, unknown>

  let watcherLimitHit = false
  const logger = vite.createLogger(undefined, { allowClearScreen: false })
  const baseInfo = logger.info.bind(logger)
  logger.info = (message, logOptions): void => {
    if (isViteConnectedMessage(message)) {
      return
    }
    baseInfo(message, logOptions)
  }
  const baseError = logger.error.bind(logger)
  logger.error = (message, logOptions): void => {
    if (isWatcherLimitError(logOptions?.error) || isWatcherLimitError(message)) {
      watcherLimitHit = true
    }
    baseError(message, logOptions)
  }

  const start = async (usePolling: boolean): Promise<ViteDevServer> => {
    const inline: InlineConfig = {
      configFile: config.configFile,
      root: config.viteRoot,
      appType: 'custom',
      customLogger: logger,
      server: {
        host,
        port,
        strictPort: true,
        // Custom locale domains must be reachable in dev.
        allowedHosts: true,
        // The browser talks HMR straight to Vite's port, so Bun.serve never
        // has to deal with the websocket upgrade.
        ws: { clientPort: port, ...(options.vite?.host ? { host } : {}) },
        ...(usePolling ? { watch: { usePolling: true, interval: 100 } } : {}),
      },
    }
    const merged = deepMerge(inline as Record<string, unknown>, extra) as InlineConfig
    const server = await vite.createServer(merged)
    server.watcher.on('error', (error: unknown) => {
      if (isWatcherLimitError(error)) {
        watcherLimitHit = true
      }
      console.error('[bunvue] vite watcher error:', error)
    })
    await server.listen()
    return server
  }

  let server = await start(false)
  // The native watcher fails immediately when the inotify instance limit is
  // reached, so a short grace period is enough to catch it.
  await Bun.sleep(50)
  if (watcherLimitHit) {
    console.warn(
      '[bunvue] the file watcher hit a system limit, restarting Vite with polling. ' +
        'Raise it with: sudo sysctl fs.inotify.max_user_instances=1024',
    )
    await server.close()
    server = await start(true)
  }

  const resolvedPort = server.config.server.port ?? port
  const origin = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${resolvedPort}`

  const ssrEnvironment = server.environments.ssr
  const runner: ModuleRunnerLike = vite.isRunnableDevEnvironment(ssrEnvironment)
    ? (ssrEnvironment.runner as unknown as ModuleRunnerLike)
    : (vite.createServerModuleRunner(ssrEnvironment) as unknown as ModuleRunnerLike)

  // A stable object the freshly imported entry is assigned into, so anything
  // holding a reference sees the latest exports.
  const entries = {} as SSREntry

  const shellCache = new Map<string, HtmlShells>()
  const indexHtmlPath = join(config.viteRoot, 'index.html')

  let lastRoutes: Routes | undefined
  let lastContextInit: ContextInit | undefined
  let inFlight: Promise<void> | undefined
  let changedAt = 0
  let clearedAt = 0
  let closed = false

  const markChanged = (): void => {
    changedAt = Date.now()
  }
  server.watcher.on('change', markChanged)
  server.watcher.on('add', markChanged)
  server.watcher.on('unlink', markChanged)

  const runtime: DevRuntime = {
    vite: server,
    origin,
    routes: [],
    routeMap: {},
    routesPayload: serializeRoutes([]),
    create: (() => {
      throw new Error('bunvue: dev runtime not initialised')
    }) as unknown as CreateFactory,
    contextInit: undefined,
    assetsDirs: [],

    async refresh(): Promise<void> {
      if (closed) {
        return
      }
      inFlight ??= load()
        .catch((error: unknown) => {
          // A close during a load makes the module runner reject with
          // "Vite module runner has been closed". Nothing is waiting for the
          // result any more, so it is not an error worth surfacing.
          if (!closed) {
            throw error
          }
        })
        .finally(() => {
          inFlight = undefined
        })
      await inFlight
    },

    async shellsFor(_routeId: string, url?: URL): Promise<HtmlShells> {
      const source = await readFile(indexHtmlPath, 'utf8')
      const transformed = await server.transformIndexHtml(url?.pathname ?? '/', source)
      let shells = shellCache.get(transformed)
      if (!shells) {
        shells = createHtmlShells(transformed)
        if (shellCache.size > 32) {
          shellCache.clear()
        }
        shellCache.set(transformed, shells)
      }
      return shells
    },

    async isViteRequest(url: URL): Promise<boolean> {
      // Everything Vite serves from the app tree carries a file extension, so
      // requiring one keeps a page query like `?url=...` out of the proxy.
      if (!hasExtension.test(url.pathname)) {
        return false
      }
      for (const marker of VITE_QUERY_MARKERS) {
        if (url.searchParams.has(marker)) {
          return true
        }
      }
      const dirs = [config.viteRoot, ...(config.publicDir ? [config.publicDir] : [])]
      for (const dir of dirs) {
        const path = safeResolve(dir, url.pathname)
        if (path && (await Bun.file(path).exists())) {
          return true
        }
      }
      return false
    },

    proxy(request: Request): Promise<Response> {
      return proxyRequest(request, origin)
    },

    fixStacktrace(error: unknown): void {
      if (error instanceof Error) {
        try {
          server.ssrFixStacktrace(error)
        } catch {
          // A malformed stack is not worth failing the error page over
        }
      }
    },

    async close(): Promise<void> {
      closed = true
      clearTimeout(pending)
      server.watcher.removeListener('add', scheduleRefresh)
      server.watcher.removeListener('unlink', scheduleRefresh)
      shellCache.clear()
      // Let an in-flight import settle before the runner disappears under it.
      try {
        await inFlight
      } catch {
        // Already reported, or irrelevant now that we are closing
      }
      try {
        await runner.close?.()
      } catch {
        // The runner may already be gone
      }
      await server.close()
    },
  }

  async function load(): Promise<void> {
    // A file event and a request can race: importing while Vite is still
    // invalidating its module graph caches a stale module that nothing
    // invalidates again. Wait for the change to settle, then drop the
    // runner's cache so the entry is evaluated from the fresh graph.
    if (changedAt > clearedAt) {
      for (let wait = SETTLE_MS - (Date.now() - changedAt); wait > 0;) {
        await Bun.sleep(wait)
        wait = SETTLE_MS - (Date.now() - changedAt)
      }
      clearedAt = changedAt
      runner.clearCache?.()
    }

    const imported = (await runner.import(config.ssrEntry)) as { default?: SSREntry }
    Object.assign(entries, imported.default ?? imported)

    const baseRoutes = (await entries.routes) as Routes
    const createModule = await entries.create
    runtime.create =
      typeof createModule === 'function'
        ? createModule
        : (createModule as { default: CreateFactory }).default

    const contextInit = (await entries.context) as ContextInit | undefined
    if (contextInit !== lastContextInit) {
      lastContextInit = contextInit
      runtime.contextInit = contextInit
      RouteContext.extend(contextInit)
    }

    // The entry's own table is what identity is compared on: expansion builds
    // a new array every time, and an unchanged entry should still short-circuit.
    if (baseRoutes === lastRoutes) {
      return
    }
    lastRoutes = baseRoutes

    const routes = expandRoutes(baseRoutes, config.i18n)
    const serialized = routes.toJSON()
    const routeMap: Record<string, SerializedRoute> = {}
    for (const route of serialized) {
      routeMap[route.key] = route
    }
    runtime.routes = Array.from(routes)
    runtime.routeMap = routeMap
    runtime.routesPayload = serializeRoutes(serialized)
    options.onRoutesChanged?.()
  }

  await runtime.refresh()

  // Adding or deleting a page changes the route table, and a browser hitting
  // the new URL would otherwise land in the fallback before any request had a
  // chance to refresh. Watching for the file event keeps the table ahead of
  // the navigation.
  let pending: ReturnType<typeof setTimeout> | undefined
  const scheduleRefresh = (file: string): void => {
    if (closed || !ROUTE_FILE.test(file)) {
      return
    }
    clearTimeout(pending)
    pending = setTimeout(() => {
      void (async () => {
        for (let attempt = 0; attempt < 3 && !closed; attempt++) {
          try {
            await runtime.refresh()
          } catch (error) {
            if (!closed) {
              console.error('[bunvue] failed to reload routes:', error)
            }
            return
          }
          await Bun.sleep(60)
        }
      })()
    }, 30)
    pending.unref?.()
  }
  server.watcher.on('add', scheduleRefresh)
  server.watcher.on('unlink', scheduleRefresh)

  return runtime
}

import type { App } from 'vue'
import type { Router } from 'vue-router'
import type { UseHeadInput, VueHeadClient } from '@unhead/vue'
import { ResponseSignal } from './signal.ts'
import type {
  ContextInit,
  DefaultState,
  NotFoundContext,
  RouteContextLike,
  RouteEntry,
  RouteMeta,
  RuntimeConfig,
  StreamWrapper,
} from './types.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

/**
 * Carries `ctx.headers` onto a response that short circuits the render, so a
 * cookie set before `ctx.redirect()` survives. Headers already on the
 * response win, except `set-cookie`, which is appended. A new `Response` is
 * built because `Response.redirect()` and fetch responses are immutable.
 */
export function mergeResponseHeaders(response: Response, extra: Headers): Response {
  const cookies = extra.getSetCookie()
  let other = false
  for (const name of extra.keys()) {
    if (name !== 'set-cookie') {
      other = true
      break
    }
  }
  if (!other && cookies.length === 0) {
    return response
  }
  const headers = new Headers(response.headers)
  for (const [name, value] of extra) {
    if (name !== 'set-cookie' && !headers.has(name)) {
      headers.set(name, value)
    }
  }
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export interface RouteContextInit<S = unknown, State = DefaultState> {
  request: Request
  url: URL
  params: Record<string, string>
  server: S
  route: RouteEntry
  /** The app's public runtime config, resolved once at startup. */
  runtimeConfig?: RuntimeConfig
  contextInit?: ContextInit<S, State>
  onNotFound?: (ctx: NotFoundContext<S>) => Response
}

/**
 * The per-request context shared by the server pipeline and the Vue app.
 * App code reaches it through `useRouteContext()`.
 */
export class RouteContext<S = unknown, State = DefaultState> {
  request: Request
  url: URL
  params: Record<string, string>
  server: S
  /** Headers merged into the final response. */
  headers: Headers
  status: number
  /** Set by `redirect()`/`notFound()`; short-circuits the render pipeline. */
  response?: Response
  /** What the page's action returned, hydrated along with the state. */
  actionData?: unknown
  /** Values stored by `useHydrationData()`, hydrated alongside the payload. */
  data: Record<string, unknown>
  /** The app's public runtime config. Ships in its own hydration block field. */
  runtimeConfig: RuntimeConfig

  ssrContext: Record<string, unknown>
  firstRender: boolean

  head: UseHeadInput
  state: State
  meta: RouteMeta

  id: string
  key: string
  name: string
  layout: string | undefined
  streaming: boolean | undefined
  clientOnly: boolean | undefined
  serverOnly: boolean | undefined

  hydration?: string
  /** Phase durations in ms, emitted as a Server-Timing header when enabled. */
  timings?: Array<[string, number]>
  mark(name: string, startedAt: number): void {
    ;(this.timings ??= []).push([name, performance.now() - startedAt])
  }
  app?: App
  router?: Router
  useHead?: VueHeadClient
  /** unhead's stream wrapper, set by the SSR entry on streaming pages. */
  wrapStream?: StreamWrapper
  error?: unknown

  private onNotFoundHandler?: (ctx: NotFoundContext<unknown>) => Response
  private body?: { kind: 'formData' | 'json'; value: Promise<unknown> }

  static async create<S, State = DefaultState>(
    init: RouteContextInit<S, State>,
  ): Promise<RouteContext<S, State>> {
    const ctx = new RouteContext<S, State>(init)
    const { contextInit } = init
    if (contextInit) {
      if (contextInit.state) {
        ctx.state = contextInit.state()
      }
      if (contextInit.default) {
        await contextInit.default(ctx as unknown as RouteContextLike<S, State>)
      }
    }
    return ctx
  }

  /** Copies named exports from the app's `context.ts` onto the prototype. */
  static extend(initial: ContextInit | undefined): void {
    if (!initial) {
      return
    }
    const { default: _default, state: _state, ...extra } = initial
    for (const [prop, value] of Object.entries(extra)) {
      Object.defineProperty(RouteContext.prototype, prop, {
        configurable: true,
        enumerable: true,
        value,
      })
    }
  }

  constructor({
    request,
    url,
    params,
    server,
    route,
    runtimeConfig,
    onNotFound,
  }: RouteContextInit<S, State>) {
    this.request = request
    this.url = url
    this.params = params
    this.server = server
    this.headers = new Headers()
    this.status = 200
    this.data = {}
    // An app that merges into `RuntimeConfig` makes `{}` too narrow for it.
    this.runtimeConfig = runtimeConfig ?? ({} as RuntimeConfig)

    this.ssrContext = {}
    this.firstRender = true

    this.head = {}
    // `state()` from the app's context.ts fills this in, when there is one.
    this.state = null as unknown as State
    this.meta = route.meta ?? {}

    this.id = route.id
    this.key = route.key
    this.name = route.name
    this.layout = route.layout
    this.streaming = route.streaming
    this.clientOnly = route.clientOnly
    this.serverOnly = route.serverOnly

    this.onNotFoundHandler = onNotFound as ((ctx: NotFoundContext<unknown>) => Response) | undefined
  }

  /** The request body as form data. Repeat calls share one read. */
  formData(): Promise<FormData> {
    return this.readBody('formData') as Promise<FormData>
  }

  /** The request body as JSON. Repeat calls share one read. */
  json<T = unknown>(): Promise<T> {
    return this.readBody('json') as Promise<T>
  }

  private readBody(kind: 'formData' | 'json'): Promise<unknown> {
    if (this.body) {
      if (this.body.kind !== kind) {
        throw new Error(
          `bunvue: the request body was already read with ctx.${this.body.kind}(), ` +
            `it cannot be read again with ctx.${kind}()`,
        )
      }
      return this.body.value
    }
    const value = kind === 'formData' ? this.request.formData() : this.request.json()
    this.body = { kind, value }
    return value
  }

  /**
   * Sets `ctx.response` to a redirect and returns a `ResponseSignal`. It does
   * not throw, so callers may keep executing; `throw ctx.redirect(...)` works
   * too and aborts the current setup function. The status defaults to 302,
   * or 303 when answering a POST, PUT, PATCH or DELETE.
   */
  redirect(to: string, status?: number): ResponseSignal {
    const location = new URL(to, this.url).toString()
    const method = this.request.method
    const response = new Response(null, {
      status: status ?? (method === 'GET' || method === 'HEAD' ? 302 : 303),
      headers: { location },
    })
    this.response = response
    return new ResponseSignal(response)
  }

  /** Same contract as `redirect()`, for a 404. */
  notFound(): ResponseSignal {
    const response =
      this.onNotFoundHandler?.(this as unknown as NotFoundContext<unknown>) ??
      new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    this.response = response
    return new ResponseSignal(response)
  }

  [inspect](): unknown {
    return {
      url: this.url.href,
      params: this.params,
      key: this.key,
      name: this.name,
      meta: this.meta,
      state: this.state,
    }
  }

  /**
   * The hydration payload (`window.route`). Deliberately excludes `request`,
   * `server`, `headers` and `response`, which are server-only. `runtimeConfig`
   * travels in its own field of the hydration block, so it is left out here.
   * `actionData` and `data` are only present when they hold something.
   */
  toJSON(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      state: this.state,
      id: this.id,
      key: this.key,
      name: this.name,
      meta: this.meta,
      head: this.head,
      layout: this.layout,
      firstRender: this.firstRender,
      clientOnly: this.clientOnly,
      streaming: this.streaming,
    }
    if (this.actionData !== undefined) {
      payload.actionData = this.actionData
    }
    if (Object.keys(this.data).length > 0) {
      payload.data = this.data
    }
    return payload
  }
}

export default RouteContext

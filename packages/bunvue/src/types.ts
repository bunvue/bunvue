import type { App, Component } from 'vue'
import type { Router } from 'vue-router'
import type { UseHeadInput, VueHeadClient } from '@unhead/vue'
import type { PreparedTemplate } from '@unhead/vue/server'
import type { RoutesPayload } from './serialize.ts'
import type { HtmlShells } from './html.ts'

/** Locale routing, passed as the `i18n` option of `createBunvue`. */
export interface I18nConfig {
  locales?: string[]
  localePrefix?: boolean
  localeDomains?: Record<string, string>
}

/**
 * The app's public runtime config, passed once to `createBunvue` and available
 * identically on the server and the client. It is empty by design: an app
 * declares its own shape by merging into it.
 *
 * ```ts
 * declare module 'bunvue/client' {
 *   interface RuntimeConfig {
 *     gtm: { id: string }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RuntimeConfig {}

/** Per-route metadata carried into the client hydration payload. */
export interface RouteMeta {
  locale?: string
  localePrefix?: boolean
  [key: string]: unknown
}

/** The subset of a page module bunvue cares about. */
export interface RouteModuleExports {
  component?: Component
  layout?: string
  path?: string
  i18n?: Record<string, string>
  streaming?: boolean
  clientOnly?: boolean
  serverOnly?: boolean
}

/**
 * What a page SFC under `pages/` may export beside its default component.
 * Import it in a page's `<script lang="ts">` block to type the exports:
 * `export const layout: PageModule['layout'] = 'admin'`.
 */
export interface PageModule {
  /** The page component itself. */
  default?: Component
  /** Name of a file in `layouts/`, without the extension. */
  layout?: string
  /** Skip SSR: the shell is sent without markup and the page mounts client side. */
  clientOnly?: boolean
  /** Render on the server only: no hydration payload and no mount script. */
  serverOnly?: boolean
  /** Stream the response with `renderToWebStream` instead of buffering it. */
  streaming?: boolean
  /** Overrides the path derived from the file name. */
  path?: string
  /** Per-locale paths, keyed by locale. */
  i18n?: Record<string, string>
  /** Anything else a page chooses to export. */
  [key: string]: unknown
}

/** A fully resolved route, one per page per locale. */
export interface RouteEntry extends RouteModuleExports {
  id: string
  name: string
  path: string
  key: string
  meta: RouteMeta
  /** Locale domain constraint, when locale domains are configured. */
  host?: string
  /**
   * The `action` export of the page's sibling `*.server.ts` file. Server only,
   * never serialized into `window.routes`.
   */
  action?: PageAction<any, any>
}

/**
 * The context a page action receives. The request has not been rendered yet,
 * so every server field is present.
 */
export interface ActionContext<S = unknown, State = DefaultState> extends RouteContextLike<
  S,
  State
> {
  request: Request
  server: S
  headers: Headers
  status: number
  /** The request body as form data, memoized. */
  formData(): Promise<FormData>
  /** The request body as JSON, memoized. */
  json<T = unknown>(): Promise<T>
}

/**
 * The `action` export of a `pages/*.server.ts` file. Runs for POST, PUT, PATCH
 * and DELETE before the Vue app is created. Returning a `Response` (or calling
 * `ctx.redirect()`) answers the request, anything else becomes `ctx.actionData`
 * and the page renders.
 */
export type PageAction<S = unknown, State = DefaultState> = (
  ctx: ActionContext<S, State>,
) => unknown | Promise<unknown>

/** A `pages/*.server.ts` module, as loaded. `action` is checked at load time. */
export interface ActionModule {
  action?: unknown
}

/** What a route looks like once serialized into `window.routes`. */
export interface SerializedRoute {
  id: string
  path: string
  name: string
  key: string
  meta: RouteMeta
  layout?: string
  clientOnly?: boolean
  serverOnly?: boolean
  streaming?: boolean
  host?: string
}

/**
 * The app's optional `context.ts` module. `State` is whatever `state()`
 * returns, so an app can type both it and the context handed to the default
 * export: `ContextInit<AppServer, AppState>`.
 */
export interface ContextInit<S = unknown, State = DefaultState> {
  state?: () => State
  default?: (ctx: RouteContextLike<S, State>) => void | Promise<void>
  /** Any other named export, copied onto the context on both sides. */
  [key: string]: unknown
}

/**
 * unhead's streaming wrapper, as returned by `createStreamableHead()` from
 * `@unhead/vue/stream/server`. Bound to the request's head instance.
 */
export type StreamWrapper = (
  stream: ReadableStream<Uint8Array>,
  template: string | PreparedTemplate,
) => ReadableStream<Uint8Array>

/** What `state` holds when an app does not type it. */
export type DefaultState = Record<string, unknown> | null

/**
 * The named exports an app's `context.ts` attaches to every context. They are
 * unknown to bunvue, so they are kept off `RouteContextLike` itself: an
 * interface with a catch-all index signature cannot be narrowed by an app
 * (TS2430) and makes `Omit` useless (TS18046).
 */
export type RouteContextExtras = Record<string, unknown>

/** `RouteContextLike` plus the `context.ts` extras, the default for `useRouteContext()`. */
export type RouteContextWithExtras<S = unknown, State = DefaultState> = RouteContextLike<S, State> &
  RouteContextExtras

/**
 * The shared per-request context, as seen by app code through
 * `useRouteContext()`. Server-only fields are optional because the client
 * gets a hydrated plain object. `S` types `ctx.server` and `State` types
 * `ctx.state`, so an app can declare its own context shape:
 * `interface AppCtx extends RouteContextLike<AppServer, AppState> {}`.
 */
export interface RouteContextLike<S = unknown, State = DefaultState> {
  request?: Request
  url: URL
  params: Record<string, string>
  server?: S
  headers?: Headers
  status?: number
  response?: Response
  redirect(to: string, status?: number): unknown
  notFound(): unknown
  /** What the page's action returned, when it ran and returned something. */
  actionData?: unknown
  /** Values stored by `useHydrationData()`. */
  data?: Record<string, unknown>
  /** The app's public runtime config, the same object on both sides. */
  runtimeConfig: RuntimeConfig
  /** Server only: the request body as form data, memoized. */
  formData?(): Promise<FormData>
  /** Server only: the request body as JSON, memoized. */
  json?<T = unknown>(): Promise<T>
  state: State
  meta: RouteMeta
  head: UseHeadInput
  id?: string
  key?: string
  name?: string
  layout?: string
  clientOnly?: boolean
  serverOnly?: boolean
  streaming?: boolean
  firstRender: boolean
  ssrContext?: Record<string, unknown>
  app?: App
  router?: Router
  useHead?: VueHeadClient
  /** Set by the SSR entry for streaming pages. Server only. */
  wrapStream?: StreamWrapper
  error?: unknown
}

/** The `create` factory exported by the `$app/index.ts` SSR entry. */
export type CreateFactory<S = unknown, State = DefaultState> = (opts: {
  routes: unknown[]
  routeMap: Record<string, unknown>
  ctxHydration: RouteContextLike<S, State>
  url?: string
}) => Promise<{ instance: App; router: Router; state?: unknown }>

/** Default export of the built SSR entry (`dist/server/index.js`). */
export interface SSREntry {
  routes: RouteEntry[] | Promise<RouteEntry[]>
  create: CreateFactory | Promise<{ default: CreateFactory }>
  context: ContextInit | Promise<ContextInit>
}

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS'

/**
 * The part of Bun's `Server` handle bunvue hands to route handlers, so a
 * proxy can learn the client address without importing Bun's types.
 */
export interface RequestIPProvider {
  requestIP(request: Request): { address: string; family: string; port: number } | null
}

export type BunRouteHandler = (
  request: Request,
  bunServer?: RequestIPProvider,
) => Response | Promise<Response>

export type BunRoutesTable = Record<string, BunRouteHandler | Record<string, BunRouteHandler>>

export interface UserRoute<S = unknown> {
  path: string
  method?: HttpMethod | HttpMethod[]
  handler: (
    request: Request,
    server: S,
    /** Bun's own `Server` handle, when the route runs under `Bun.serve`. */
    bunServer?: RequestIPProvider,
  ) => Response | Promise<Response>
}

export type Middleware<S = unknown> = (
  request: Request,
  next: () => Promise<Response>,
  server: S,
) => Response | Promise<Response>

export interface NotFoundContext<S = unknown> {
  request?: Request
  url: URL
  server?: S
  [key: string]: unknown
}

export interface StaticOptions {
  maxAge?: number
  immutable?: boolean
}

export interface ViteDevOptions {
  port?: number
  host?: string
  config?: Record<string, unknown>
}

export interface BunvueOptions<S = undefined> {
  root: string | URL
  dev?: boolean
  server?: S
  routes?: UserRoute<S>[]
  middleware?: Middleware<S>[]
  vite?: ViteDevOptions
  static?: StaticOptions
  onError?: (error: unknown, request: Request) => Response | Promise<Response>
  onNotFound?: (ctx: NotFoundContext<S>) => Response
  /**
   * Public app config, serialized once at startup and shipped in the hydration
   * block, so `useRuntimeConfig()` reads the same object on both sides. It must
   * be plain JSON. It is public by definition: anything private belongs on
   * `ctx.server`. Default: `{}`.
   */
  runtimeConfig?: RuntimeConfig
  /**
   * Locale routing, replacing the `i18n.config.ts` file bunvue used to read
   * from the Vite root. It is resolved at process start, so `localeDomains`
   * can come from the environment and one build can serve staging and
   * production:
   *
   * ```ts
   * i18n: {
   *   locales: ['se', 'fi'],
   *   localeDomains: { se: process.env.SE_HOST ?? 'se.test', fi: process.env.FI_HOST! },
   * }
   * ```
   *
   * Nothing here is bundled or sent to the browser. An app that needs its
   * locales client side puts them in `runtimeConfig`.
   */
  i18n?: I18nConfig
  /** Emit a Server-Timing header with per-phase durations. Default: BUNVUE_TIMING=1. */
  timing?: boolean
  /**
   * Origin check for requests that reach a page action. Enabled by default,
   * `false` turns it off, `trustedOrigins` accepts other origins.
   */
  csrf?: false | CsrfOptions
}

export interface CsrfOptions {
  /**
   * Full origins on other hosts that may submit to page actions. The request's
   * own host is always accepted, whatever the scheme.
   */
  trustedOrigins?: string[]
}

/** The `bunvue` key written into `dist/vite.config.json`. */
export interface BunvueViteConfig {
  outDirs?: Record<string, string>
  entryPaths?: Record<string, string>
}

/** The JSON structure written to `dist/vite.config.json` by the plugin. */
export interface SerializableViteConfig {
  base?: string
  root: string
  build: {
    assetsDir: string
    outDir: string
  }
  bunvue?: BunvueViteConfig
}

export interface ResolvedPaths {
  /** Package root of the application (the directory holding package.json). */
  appRoot: string
  clientOutDir: string
  ssrOutDir: string
  assetsDir: string
  base: string
}

/**
 * The per-mode runtime the request pipeline talks to. Production resolves
 * everything once at `ready()`; development refreshes it per request from the
 * Vite module runner.
 */
export interface Runtime {
  routes: RouteEntry[]
  routeMap: Record<string, SerializedRoute>
  routesPayload: RoutesPayload
  create: CreateFactory
  contextInit?: ContextInit
  /** Per-page HTML shells. Dev needs the request URL for `transformIndexHtml`. */
  shellsFor(routeId: string, url?: URL): HtmlShells | Promise<HtmlShells>
  assetsDirs: string[]
  /** Dev only: re-import the SSR entry through the module runner. */
  refresh?: () => Promise<void>
  /** Dev only: close the module runner and the Vite server. */
  close?: () => Promise<void>
}

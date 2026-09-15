import { inject } from 'vue'
import type { Ref } from 'vue'
import {
  createMemoryHistory,
  createWebHistory,
  useRoute,
  useRouter,
  type LocationQueryRaw,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type Router,
} from 'vue-router'
import type {
  ActionContext,
  ContextInit,
  DefaultState,
  I18nConfig,
  PageAction,
  PageModule,
  RouteContextExtras,
  RouteContextLike,
  RouteContextWithExtras,
  RuntimeConfig,
  SerializedRoute,
} from './types.ts'

export { ResponseSignal, isResponseSignal, kResponseSignal } from './signal.ts'
export { createBunvueApp } from './create-app.ts'
export type { CreatedApp, CreateBunvueAppOptions, RootModule } from './create-app.ts'
export type {
  RouteContextLike,
  RouteContextExtras,
  RouteContextWithExtras,
  DefaultState,
  SerializedRoute,
  ContextInit,
  I18nConfig,
  PageModule,
  PageAction,
  ActionContext,
  RuntimeConfig,
}

export const isServer = typeof window === 'undefined'
export const createHistory = isServer ? createMemoryHistory : createWebHistory

export const serverRouteContext = Symbol('serverRouteContext')
export const routeLayout = Symbol('routeLayout')

/**
 * The one accessor app code needs. On the server it reads the injected
 * per-request context, on the client the hydrated one stored on the matched
 * route's meta.
 *
 * `T` is the app's own context type, so an app that declares
 * `interface AppCtx extends RouteContextLike<AppServer, AppState> {}` reads
 * `ctx.server` and `ctx.state` fully typed. Without one the context carries
 * the `context.ts` extras as `unknown`.
 */
export function useRouteContext<
  T extends RouteContextLike<unknown, unknown> = RouteContextWithExtras,
>(): T {
  if (isServer) {
    return inject(serverRouteContext) as T
  }
  return (useRoute().meta as Record<symbol, unknown>)[serverRouteContext] as T
}

/**
 * The app's public runtime config, the same object on the server and the
 * client. Call it inside a component's setup, on either side. `T` narrows the
 * return type for an app that would rather pass its own interface than merge
 * into `RuntimeConfig`.
 */
export function useRuntimeConfig<T = RuntimeConfig>(): T {
  return useRouteContext().runtimeConfig as unknown as T
}

/**
 * In-flight fetches of `useHydrationData()`, per context, so two components
 * asking for the same key during one server render share one fetch. Kept off
 * the context itself, where it would end up in the hydration payload.
 */
const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>()

/**
 * Fetches on the server, ships the result in the hydration payload and reuses
 * it on the client for the hydrating render. After a client side navigation
 * the payload is gone and the fetcher runs in the browser instead.
 *
 * The key identifies the value in the payload, so it has to carry everything
 * the result varies by: `` `product:${slug}` ``, not `'product'`. The awaited
 * value is returned as is, not a ref and not made reactive. A fetcher that
 * throws propagates and stores nothing, so a page can still call
 * `ctx.notFound()` from a catch.
 */
export async function useHydrationData<T>(key: string, fetcher: () => T | Promise<T>): Promise<T> {
  return await resolveHydrationData(useRouteContext(), key, fetcher)
}

/** The body of `useHydrationData()`, with the context passed in. */
export async function resolveHydrationData<T>(
  ctx: RouteContextLike<unknown, unknown>,
  key: string,
  fetcher: () => T | Promise<T>,
): Promise<T> {
  const store = ctx.data
  if (store && key in store) {
    return store[key] as T
  }
  // On the client the payload is the only source: a miss means the page was
  // reached by navigation, and the result belongs to this render alone.
  if (!isServer || !store) {
    return await fetcher()
  }
  let pending = inFlight.get(ctx)
  if (!pending) {
    pending = new Map()
    inFlight.set(ctx, pending)
  }
  const running = pending.get(key)
  if (running) {
    return (await running) as T
  }
  const promise = (async (): Promise<T> => {
    const value = await fetcher()
    store[key] = value
    return value
  })()
  pending.set(key, promise)
  try {
    return await promise
  } finally {
    pending.delete(key)
  }
}

/** A hydrated route: the serialized payload plus a memoized module loader. */
export interface HydratedRoute extends SerializedRoute {
  loader: () => Promise<Record<string, unknown>>
  component: () => Promise<Record<string, unknown>>
}

/**
 * Locale-domain aware key lookup: the host-constrained route wins, then the
 * unconstrained one.
 */
export function resolveRouteKey<T>(
  hostname: string,
  path: string,
  routeMap: Record<string, T>,
): T | undefined {
  return routeMap[`${hostname}__${path}`] ?? routeMap[`*__${path}`]
}

export interface BeforeEachArgs {
  routeMap: Record<string, SerializedRoute>
  ctxHydration: RouteContextLike
}

/**
 * Server-side guard. Several locales can share a path, so after vue-router
 * matches by path we swap in the route whose host constraint matches the
 * request.
 */
export function createServerBeforeEach({ routeMap, ctxHydration }: BeforeEachArgs) {
  return function serverBeforeEach(to: RouteLocationNormalized) {
    const path = to.matched[0]?.path ?? '/'
    const route = resolveRouteKey(ctxHydration.url.hostname, path, routeMap)
    if (route && to.name !== route.name) {
      return { name: route.name, params: to.params, query: to.query }
    }
    return undefined
  }
}

/**
 * Client-side guard. Performs the same name swap by hostname and refreshes
 * `url`, `params`, `meta` and the layout on the hydrated context. The action
 * result and the hydration data belong to the server response only, so both
 * are dropped on the first client navigation.
 */
export function createClientBeforeEach(
  { routeMap, ctxHydration }: BeforeEachArgs,
  layout: Ref<string>,
) {
  let firstDone = false
  return function clientBeforeEach(to: RouteLocationNormalized) {
    const path = to.matched[0]?.path ?? '/'
    const route = resolveRouteKey(window.location.hostname, path, routeMap)
    if (route && to.name !== route.name) {
      return { name: route.name, params: to.params, query: to.query }
    }

    if (firstDone) {
      ctxHydration.firstRender = false
      ctxHydration.actionData = undefined
      ctxHydration.data = undefined
    } else {
      firstDone = true
    }

    ctxHydration.url = new URL(to.fullPath, window.location.origin)
    ctxHydration.params = { ...to.params } as Record<string, string>
    if (route) {
      ctxHydration.id = route.id
      ctxHydration.key = route.key
      ctxHydration.name = route.name
      ctxHydration.meta = route.meta ?? {}
      ctxHydration.layout = route.layout
      ctxHydration.clientOnly = route.clientOnly
    }

    layout.value = ctxHydration.layout ?? 'default'
    ;(to.meta as Record<symbol, unknown>)[serverRouteContext] = ctxHydration
    return undefined
  }
}

/**
 * Gives the hydrated context isomorphic `redirect()` / `notFound()`, backed by
 * `router.push` so composables can call them on either side.
 */
export function attachClientNavigation(ctx: RouteContextLike, router: Router): void {
  ctx.redirect = (to: string): undefined => {
    void router.push(to)
    return undefined
  }
  ctx.notFound = (): undefined => {
    void router.push('/')
    return undefined
  }
}

/** Copies named exports from `context.ts` onto the hydrated context. */
export async function extendContext(
  ctx: RouteContextLike,
  contextModule: ContextInit,
): Promise<RouteContextLike> {
  const { default: setter, state: _state, ...extra } = contextModule
  Object.assign(ctx, extra)
  if (setter) {
    await setter(ctx)
  }
  return ctx
}

/** The id of the `<script type="application/json">` block the server emits. */
const HYDRATION_ID = '__bunvue__'

/** The three fields of the hydration block, before any devalue revival. */
export interface HydrationBlock {
  route: unknown
  routes: unknown
  runtimeConfig: unknown
}

/**
 * Reads the hydration payload out of the JSON block.
 *
 * The block is data, never executed, so it has to be parsed here. `data-format`
 * says whether `route` and `routes` are plain JSON or devalue's reduced form (a
 * flat array of nodes with back references, which carries Date, Map, Set,
 * undefined, NaN, BigInt, RegExp and shared or cyclic references). devalue is
 * imported only in that branch, so the JSON path ships none of it.
 *
 * `runtimeConfig` is plain JSON whatever the format says: the server validated
 * it as such at startup.
 */
export async function readHydrationBlock(): Promise<HydrationBlock> {
  const element = document.getElementById(HYDRATION_ID)
  if (!element) {
    throw new Error(`bunvue: no hydration payload found (#${HYDRATION_ID})`)
  }
  const block = JSON.parse(element.textContent ?? '{}') as HydrationBlock
  if (element.getAttribute('data-format') !== 'devalue') {
    return block
  }
  const { unflatten } = await import('devalue')
  return {
    route: unflatten(block.route as number | unknown[]),
    routes: unflatten(block.routes as number | unknown[]),
    runtimeConfig: block.runtimeConfig,
  }
}

function memoImport(
  loader: () => Promise<Record<string, unknown>>,
): () => Promise<Record<string, unknown>> {
  let executed = false
  let value: Record<string, unknown>
  return async () => {
    if (!executed) {
      value = await loader()
      executed = true
    }
    return value
  }
}

/**
 * Rehydrates `window.routes` into vue-router route records by attaching the
 * matching lazy page loaders from the client glob.
 */
export async function hydrateRoutes(
  from: Record<string, () => Promise<Record<string, unknown>>>,
): Promise<HydratedRoute[]> {
  const serialized = (window as unknown as { routes: SerializedRoute[] }).routes ?? []
  return serialized.map((route) => {
    const hydrated = route as HydratedRoute
    hydrated.loader = memoImport(from[route.id])
    hydrated.component = () => hydrated.loader()
    return hydrated
  })
}

/**
 * Where a locale aware link points: a base route name (`'about'`,
 * `'product'`), an unlocalised path (`'/about'`, `'/product/x'`), or a named
 * location with params, query and hash.
 */
export type LocaleTarget =
  | string
  | { name: string; params?: Record<string, string>; query?: LocationQueryRaw; hash?: string }

/** What `useLocaleRoutes()` hands back. */
export interface LocaleRoutes {
  /** The current locale, from the matched route's `meta.locale`. */
  locale: string
  /** Every locale in the route table, in table order. The first is the default. */
  locales: string[]
  /** A vue-router location for `to` in `locale`, defaulting to the current one. */
  localePath(to: LocaleTarget, locale?: string): RouteLocationRaw
  /** An href for `to` in `locale`, absolute when that locale lives on another host. */
  localeHref(to: LocaleTarget, locale?: string): string
  /** The current page in `locale`, keeping the current params unless `params` is given. */
  switchLocalePath(locale: string, params?: Record<string, string>): string
}

/**
 * The serialized route table, provided by `createBunvueApp()` so composables can
 * read it on both sides without going through `window.routes`.
 */
export const serializedRoutes = Symbol('serializedRoutes')

/** Targets already warned about, so a link rendered in a list warns once. */
const warnedTargets = new Set<string>()

/**
 * Dev only. `import.meta.env` is Vite's on the client and Bun's on the server,
 * and a missing `DEV` simply means no warning rather than a special case.
 */
function warnUnresolved(target: string): void {
  const env: Record<string, unknown> = import.meta.env ?? {}
  if (!env.DEV || warnedTargets.has(target)) {
    return
  }
  warnedTargets.add(target)
  console.warn(`[bunvue] useLocaleRoutes: no route matched ${target}`)
}

/** A target reduced to a base route name plus what the caller wants carried over. */
interface LocaleTargetParts {
  name: string
  params?: Record<string, string>
  query?: LocationQueryRaw
  hash?: string
}

/**
 * Locale aware links, derived from the route table alone: no i18n config is
 * sent to the client and none is needed. Route names are `${locale}__${base}`
 * and the paths already carry whatever prefix or `i18n` override the page has,
 * so an app links by base name and lets this resolve the rest.
 *
 * ```vue
 * const { locale, locales, localePath, switchLocalePath } = useLocaleRoutes()
 * ```
 *
 * Call it inside a component's setup, like the other composables. `locale` is
 * a getter on the returned object, so destructuring it freezes the value of
 * the current page while the functions keep working after a navigation.
 */
export function useLocaleRoutes(): LocaleRoutes {
  const table = (inject(serializedRoutes, undefined) as SerializedRoute[] | undefined) ?? []
  const router = useRouter()
  const ctx = useRouteContext()

  const locales: string[] = []
  const byName = new Map<string, SerializedRoute>()
  let prefixed = false
  for (const route of table) {
    byName.set(route.name, route)
    const locale = route.meta?.locale
    if (locale && !locales.includes(locale)) {
      locales.push(locale)
    }
    if (route.meta?.localePrefix) {
      prefixed = true
    }
  }
  const defaultLocale = locales[0] ?? ''
  // The form a prefixed table holds the default locale in, `/en/about` for
  // `/about`. Empty with locale domains, where paths are unprefixed.
  const defaultPrefix = prefixed && defaultLocale ? `/${defaultLocale}` : ''

  function currentLocale(): string {
    return ctx.meta?.locale ?? defaultLocale
  }

  /** `fi__about` becomes `about`, a name without a known locale stays itself. */
  function baseName(name: string): string {
    const at = name.indexOf('__')
    if (at === -1) {
      return name
    }
    return locales.includes(name.slice(0, at)) ? name.slice(at + 2) : name
  }

  function routeFor(base: string, locale: string): SerializedRoute | undefined {
    return byName.get(`${locale}__${base}`) ?? byName.get(base)
  }

  function parse(to: LocaleTarget): LocaleTargetParts | undefined {
    if (typeof to !== 'string') {
      return { name: baseName(to.name), params: to.params, query: to.query, hash: to.hash }
    }
    if (!to.startsWith('/')) {
      return { name: baseName(to) }
    }
    for (const candidate of candidates(to)) {
      const matched = router.resolve(candidate)
      if (matched.matched.length === 0 || typeof matched.name !== 'string') {
        continue
      }
      return {
        name: baseName(matched.name),
        params: { ...matched.params } as Record<string, string>,
        query: matched.query,
        hash: matched.hash,
      }
    }
    return undefined
  }

  /** True when the path already starts with one of the table's locales. */
  function namesLocale(path: string): boolean {
    return locales.includes(path.slice(1).split(/[/?#]/)[0] as string)
  }

  /**
   * The paths to try for a path target, in order. Paths are matched by
   * vue-router itself, and with a locale prefix an unlocalised path only
   * matches once the default locale sits in front of it, so that form goes
   * first unless the path already names a locale. The index is the exception:
   * the default locale keeps the bare root.
   */
  function candidates(to: string): string[] {
    if (!defaultPrefix || namesLocale(to)) {
      return [to]
    }
    if (to === '/') {
      return ['/', defaultPrefix]
    }
    return [`${defaultPrefix}${to}`, to]
  }

  function locate(
    to: LocaleTarget,
    locale?: string,
  ): { route: SerializedRoute; location: RouteLocationRaw } | undefined {
    const parts = parse(to)
    if (!parts) {
      return undefined
    }
    const route = routeFor(parts.name, locale ?? currentLocale())
    if (!route) {
      return undefined
    }
    return {
      route,
      location: { name: route.name, params: parts.params, query: parts.query, hash: parts.hash },
    }
  }

  function describe(to: LocaleTarget): string {
    return typeof to === 'string' ? to : to.name
  }

  function localePath(to: LocaleTarget, locale?: string): RouteLocationRaw {
    const found = locate(to, locale)
    if (!found) {
      warnUnresolved(describe(to))
      return to as RouteLocationRaw
    }
    return found.location
  }

  function localeHref(to: LocaleTarget, locale?: string): string {
    const found = locate(to, locale)
    if (!found) {
      warnUnresolved(describe(to))
      return describe(to)
    }
    const href = router.resolve(found.location).href
    // The current URL is the only source of a scheme and a port: dev and test
    // setups run every locale host on one port, and so does production on 443.
    const here = isServer ? ctx.url : window.location
    if (found.route.host && found.route.host !== here.hostname) {
      return `${here.protocol}//${found.route.host}${here.port ? `:${here.port}` : ''}${href}`
    }
    return href
  }

  function switchLocalePath(locale: string, params?: Record<string, string>): string {
    const current = router.currentRoute.value
    return localeHref(
      {
        name: baseName(typeof current.name === 'string' ? current.name : ''),
        params: params ?? ({ ...current.params } as Record<string, string>),
        query: current.query,
        hash: current.hash,
      },
      locale,
    )
  }

  return {
    get locale(): string {
      return currentLocale()
    },
    locales,
    localePath,
    localeHref,
    switchLocalePath,
  }
}

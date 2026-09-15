import type {
  ActionModule,
  I18nConfig,
  PageAction,
  RouteEntry,
  RouteModuleExports,
  SerializedRoute,
} from './types.ts'

/** `[id]` / `[slug+]` in a page filename. */
const PARAM = /\[([.\w]+\+?)\]/

/** Extensions of a page's sibling action file, in order of preference. */
const ACTION_EXTENSIONS = ['.server.ts', '.server.js']

type RawRouteModule = RouteModuleExports & { default?: unknown; [key: string]: unknown }
type RouteModuleInput = (() => Promise<RawRouteModule>) | RawRouteModule
type ActionModuleInput = (() => Promise<ActionModule>) | ActionModule

/**
 * Action files already warned about. Kept on `globalThis` because in dev this
 * module is re-evaluated on every change, and the warning should not repeat.
 */
const warnedActions = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('bunvue.warnedActions')
] ??= new Set<string>()) as Set<string>

function warnOnce(key: string, message: string): void {
  if (warnedActions.has(key)) {
    return
  }
  warnedActions.add(key)
  console.warn(message)
}

/**
 * Pairs page glob keys with their sibling `*.server.{ts,js}` files and loads
 * the `action` export on demand. `orphans()` lists the files no page claimed.
 */
function actionPairing(actions: Record<string, ActionModuleInput>) {
  const claimed = new Set<string>()
  return {
    async actionFor(pageKey: string): Promise<PageAction | undefined> {
      const stem = pageKey.replace(/\.vue$/, '')
      for (const extension of ACTION_EXTENSIONS) {
        const key = `${stem}${extension}`
        const input = actions[key]
        if (!input) {
          continue
        }
        claimed.add(key)
        const loaded = typeof input === 'function' ? await input() : input
        if (typeof loaded.action !== 'function') {
          warnOnce(key, `[bunvue] ${key.slice(1)} has no \`action\` export and is ignored`)
          return undefined
        }
        return loaded.action as PageAction
      }
      return undefined
    },
    orphans(): string[] {
      return Object.keys(actions).filter((key) => !claimed.has(key))
    },
  }
}

export class Routes extends Array<RouteEntry> {
  toJSON(): SerializedRoute[] {
    const out: SerializedRoute[] = []
    for (let i = 0; i < this.length; i++) {
      const route = this[i] as RouteEntry
      out.push({
        id: route.id,
        path: route.path,
        name: route.name,
        key: route.key,
        meta: route.meta,
        layout: route.layout,
        clientOnly: route.clientOnly,
        serverOnly: route.serverOnly,
        streaming: route.streaming,
        host: route.host,
      })
    }
    return out
  }
}

function routeModuleExports(routeModule: RawRouteModule): RouteModuleExports {
  return {
    component: routeModule.default as RouteModuleExports['component'],
    layout: routeModule.layout,
    path: routeModule.path,
    i18n: routeModule.i18n,
    streaming: routeModule.streaming,
    clientOnly: routeModule.clientOnly,
    serverOnly: routeModule.serverOnly,
  }
}

async function getRouteModule(input: RouteModuleInput): Promise<RouteModuleExports> {
  if (typeof input === 'function') {
    return routeModuleExports(await input())
  }
  return routeModuleExports(input)
}

/** Derives `name` and `path` from a `/pages/**\/*.vue` glob key. */
export function baseNameAndPath(globPath: string): { name: string; path: string } {
  const stem = globPath.slice('/pages'.length, -'.vue'.length)
  let name = stem
    .replace(PARAM, () => '')
    .replace(/^\/*|\/*$/g, '')
    .replace(/\//g, '_')
  if (name === '') {
    name = 'catch-all'
  }
  const path = stem
    .replace(PARAM, (_m, param: string) => `:${param}`)
    .replace(/\/index$/, '/')
    .replace(/(.+)\/+$/, (..._m: unknown[]) => _m[1] as string)
  return { name, path: path === '' ? '/' : path }
}

export interface ExpandOptions {
  i18n?: I18nConfig
}

/**
 * Expands one page into its per-locale routes.
 *
 * With locale domains the route gets a `host` constraint and the key
 * `${host}__${path}`; with a locale prefix the path is prefixed and the key is
 * `*__${path}`. Without i18n a single route with key `*__${path}` is returned.
 */
export function expandRoute(base: RouteEntry, i18n: I18nConfig | undefined): RouteEntry[] {
  const locales = i18n?.locales ?? []
  const localeDomains = i18n?.localeDomains ?? {}
  const localePrefix = i18n?.localePrefix ?? false
  const enabled = locales.length > 0 && (Object.keys(localeDomains).length > 0 || localePrefix)
  const defaultLocale = locales.length > 0 ? locales[0] : 'en'

  base.meta = { locale: defaultLocale, localePrefix }
  base.key = `*__${base.path}`

  if (!enabled) {
    return [base]
  }

  const expanded: RouteEntry[] = []
  for (const locale of locales) {
    const route: RouteEntry = { ...base }
    route.name = `${locale}__${base.name}`
    route.meta = { locale, localePrefix }

    const localePath = base.i18n?.[locale]
    if (localePath) {
      route.path = localePath
    }

    const domain = localeDomains[locale]
    if (domain) {
      route.host = domain
      route.key = `${domain}__${route.path}`
    } else if (localePrefix) {
      if (route.path === '/') {
        route.path = locale === defaultLocale ? '/' : `/${locale}`
      } else {
        route.path = `/${locale}${route.path}`
      }
      route.key = `*__${route.path}`
    } else {
      route.key = `*__${route.path}`
    }

    expanded.push(route)
  }
  return expanded
}

/**
 * Expands a base route table into its per-locale routes. Called once at
 * startup with the `i18n` option of `createBunvue`, and again in dev whenever
 * the SSR entry hands back a new table.
 *
 * `expandRoute()` rewrites `meta` and `key` on the entry it is given, so each
 * base entry is copied first and the table it came from stays expandable.
 */
export function expandRoutes(routes: Iterable<RouteEntry>, i18n: I18nConfig | undefined): Routes {
  const expanded: RouteEntry[] = []
  for (const base of routes) {
    expanded.push(...expandRoute({ ...base }, i18n))
  }
  return new Routes(...expanded)
}

/**
 * Builds the base route table from `import.meta.glob('/pages/**\/*.vue')`, one
 * entry per page. Consumed by the `$app/index.ts` virtual module, which also
 * passes the `pages/**\/*.server.{ts,js}` glob: each page gets the `action` of
 * its sibling file, shared by all of its locale routes.
 *
 * Locale expansion happens at startup instead, in `expandRoutes()`, so the
 * `i18n` option of `createBunvue` can be built from the environment.
 */
export async function createRoutes(
  fromPromise: Promise<{ default: Record<string, RouteModuleInput> | RouteEntry[] }>,
  actionsPromise?: Promise<{ default: Record<string, ActionModuleInput> }>,
): Promise<Routes> {
  const { default: from } = await fromPromise
  const pairing = actionPairing(actionsPromise ? (await actionsPromise).default : {})

  const collected: RouteEntry[] = []

  if (Array.isArray(from)) {
    for (const routeDef of from) {
      const routeModule = await getRouteModule(routeDef.component as RouteModuleInput)
      const base: RouteEntry = {
        id: routeDef.path,
        name: routeDef.name ?? routeDef.path,
        path: routeDef.path,
        key: `*__${routeDef.path}`,
        meta: {},
        ...routeModule,
      }
      base.path = routeModule.path ?? routeDef.path
      base.key = `*__${base.path}`
      base.action = routeDef.action ?? (await pairing.actionFor(routeDef.id ?? ''))
      collected.push(base)
    }
  } else {
    // Static routes before dynamic ones
    const importPaths = Object.keys(from).sort((a, b) => (a > b ? -1 : 1))
    for (const globPath of importPaths) {
      const routeModule = await getRouteModule(from[globPath] as RouteModuleInput)
      const { name, path } = baseNameAndPath(globPath)
      const base: RouteEntry = {
        id: globPath,
        name,
        path: routeModule.path ?? path,
        key: '',
        meta: {},
        ...routeModule,
      }
      base.path = routeModule.path ?? path
      base.key = `*__${base.path}`
      base.action = await pairing.actionFor(globPath)
      collected.push(base)
    }
  }

  for (const orphan of pairing.orphans()) {
    warnOnce(orphan, `[bunvue] ${orphan.slice(1)} has no matching page and is ignored`)
  }

  return new Routes(...collected)
}

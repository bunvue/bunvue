import type { BunRoutesTable, BunRouteHandler, RouteEntry } from './types.ts'

/** Trailing `:param+` catch-alls, which Bun spells as `*`. */
const CATCH_ALL = /:(\w[\w-]*)\+.*$/

export interface PathPattern {
  /** The Bun.serve route pattern. */
  pattern: string
  /** When the pattern ends in `*`, the original param name it stands for. */
  wildcardParam?: string
}

/**
 * Converts a vue-router path into a Bun.serve route pattern. `:id` is kept
 * as-is (Bun uses the same syntax); `:slug+` becomes `/*` and the original
 * param name is remembered so `params['*']` can be mapped back to it.
 */
export function toBunPattern(path: string): PathPattern {
  const match = path.match(CATCH_ALL)
  if (!match) {
    return { pattern: path === '' ? '/' : path }
  }
  const pattern = path.replace(CATCH_ALL, '*')
  return { pattern: pattern === '' ? '/*' : pattern, wildcardParam: match[1] }
}

export interface PatternGroup extends PathPattern {
  candidates: RouteEntry[]
}

/**
 * Groups routes by their Bun path pattern. Several locale-domain routes share
 * one pattern and are disambiguated at request time by hostname.
 */
export function groupRoutesByPattern(routes: RouteEntry[]): Map<string, PatternGroup> {
  const groups = new Map<string, PatternGroup>()
  for (const route of routes) {
    const { pattern, wildcardParam } = toBunPattern(route.path)
    let group = groups.get(pattern)
    if (!group) {
      group = { pattern, wildcardParam, candidates: [] }
      groups.set(pattern, group)
    }
    if (wildcardParam && !group.wildcardParam) {
      group.wildcardParam = wildcardParam
    }
    group.candidates.push(route)
  }
  return groups
}

/**
 * Picks the route for a request: a host-constrained candidate matching the
 * request hostname wins, then an unconstrained one, else nothing (404).
 */
export function selectCandidate(
  candidates: RouteEntry[],
  hostname: string,
): RouteEntry | undefined {
  for (const candidate of candidates) {
    if (candidate.host && candidate.host === hostname) {
      return candidate
    }
  }
  for (const candidate of candidates) {
    if (!candidate.host) {
      return candidate
    }
  }
  return undefined
}

/**
 * Maps Bun's `params['*']` back onto the original catch-all param name. Bun
 * does not currently expose a value for `*`, so the rest of the path is
 * recovered from the pattern and the request pathname when needed.
 */
export function normalizeParams(
  params: Record<string, string> | undefined,
  wildcardParam: string | undefined,
  pattern?: string,
  pathname?: string,
): Record<string, string> {
  const out: Record<string, string> = { ...(params ?? {}) }
  if (!wildcardParam) {
    return out
  }
  let rest = typeof out['*'] === 'string' ? out['*'] : undefined
  if (rest === undefined && pattern?.endsWith('*') && pathname !== undefined) {
    const prefix = pattern.slice(0, -1)
    if (pathname.startsWith(prefix)) {
      rest = pathname.slice(prefix.length)
    }
  }
  if (rest !== undefined) {
    out['*'] = rest
    out[wildcardParam] = safeDecode(rest)
  }
  return out
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Every method is registered on each page pattern: Bun hands a method missing
 * from a per-method object to the `fetch` fallback, and bunvue wants to answer
 * 405 itself.
 */
export const APP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** The `Allow` header of a page without an action. */
export const READ_METHODS = 'GET, HEAD'

/** The `Allow` header of a page with an action. */
export const ACTION_METHODS = APP_METHODS.join(', ')

/** Wraps one handler as a per-method object for the Bun routes table. */
export function methodObject(handler: BunRouteHandler): Record<string, BunRouteHandler> {
  const entry: Record<string, BunRouteHandler> = {}
  for (const method of APP_METHODS) {
    entry[method] = handler
  }
  return entry
}

export type AppHandlerFactory = (group: PatternGroup) => BunRouteHandler

/**
 * Builds the app portion of the Bun routes table: one entry per distinct path
 * pattern, each with a per-method handler object.
 */
export function buildAppRoutes(
  routes: RouteEntry[],
  createHandler: AppHandlerFactory,
): BunRoutesTable {
  const table: BunRoutesTable = {}
  for (const group of groupRoutesByPattern(routes).values()) {
    table[group.pattern] = methodObject(createHandler(group))
  }
  return table
}

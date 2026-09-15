import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { serializeRoutes } from './serialize.ts'
import type { ResolvedConfig } from './config.ts'
import { createHtmlShells, type HtmlShells } from './html.ts'
import { RouteContext } from './context.ts'
import type { ContextInit, CreateFactory, Runtime, SerializedRoute, SSREntry } from './types.ts'
import { expandRoutes, type Routes } from './server.ts'

export type { Runtime } from './types.ts'

async function loadSSRBundle(ssrOutDir: string, ssrEntry: string): Promise<SSREntry> {
  const name = parse(ssrEntry).name
  for (const candidate of [`${name}.js`, `${name}.mjs`]) {
    const path = resolve(ssrOutDir, candidate)
    if (existsSync(path)) {
      const bundle = (await import(path)) as { default?: unknown }
      const entry = (bundle.default ?? bundle) as SSREntry
      return entry
    }
  }
  throw new Error(`bunvue: no SSR entry (${name}.js) found in ${ssrOutDir}`)
}

/**
 * Loads the production SSR bundle and pre-compiles one HTML shell per page
 * (several locale routes share the shell of their page).
 */
export async function createProdRuntime(config: ResolvedConfig): Promise<Runtime> {
  const entry = await loadSSRBundle(config.ssrOutDir, config.ssrEntry)

  const routes = expandRoutes((await entry.routes) as Routes, config.i18n)
  const createModule = await entry.create
  const create =
    typeof createModule === 'function'
      ? createModule
      : (createModule as { default: CreateFactory }).default
  const contextInit = (await entry.context) as ContextInit | undefined

  RouteContext.extend(contextInit)

  const routeMap: Record<string, SerializedRoute> = {}
  const serialized = routes.toJSON()
  for (const route of serialized) {
    routeMap[route.key] = route
  }
  const routesPayload = serializeRoutes(serialized)

  const indexHtml = await readFile(join(config.clientOutDir, 'index.html'), 'utf8')
  const fallbackShells = createHtmlShells(indexHtml)

  const shells = new Map<string, HtmlShells>()
  for (const route of routes) {
    if (shells.has(route.id)) {
      continue
    }
    const htmlPath = route.id.replace('pages/', 'html/').replace(/\.vue$/, '.html')
    const shellPath = join(config.clientOutDir, htmlPath)
    if (existsSync(shellPath)) {
      shells.set(route.id, createHtmlShells(await readFile(shellPath, 'utf8')))
    } else {
      shells.set(route.id, fallbackShells)
    }
  }

  const assetsDirs = [resolve(config.clientOutDir, config.assetsDir)]
  const ssrAssets = resolve(config.ssrOutDir, config.assetsDir)
  if (existsSync(ssrAssets)) {
    assetsDirs.push(ssrAssets)
  }

  return {
    routes: Array.from(routes),
    routeMap,
    routesPayload,
    create,
    contextInit,
    shellsFor(routeId: string): HtmlShells {
      return shells.get(routeId) ?? fallbackShells
    },
    assetsDirs,
  }
}

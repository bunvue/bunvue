import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const prefix = /^\/?\$app\//

const virtualRoot = resolve(import.meta.dirname, '..', '..', 'virtual-ts')

/** Virtual module stems, resolved against `virtual-ts/`. */
const stems = ['index', 'mount', 'routes', 'router.vue', 'root', 'context', 'actions'] as const

/**
 * Convention files: when the app provides one in the Vite root it wins over
 * the bunvue placeholder.
 */
const conventions: Record<string, string[]> = {
  context: ['context.ts', 'context.js'],
  root: ['root.vue'],
}

function stripExt(virtual: string): string {
  return virtual.endsWith('.vue') ? virtual : virtual.replace(/\.(js|ts)$/, '')
}

/** Maps a `$app/<name>` request onto a file inside `virtual-ts/`. */
export function virtualFileName(virtual: string): string | undefined {
  const stem = stripExt(virtual)
  if (!(stems as readonly string[]).includes(stem)) {
    return undefined
  }
  return stem.endsWith('.vue') ? stem : `${stem}.ts`
}

/**
 * The canonical id for a `$app/*` request: `/$app/` plus the file name that
 * `load()` returns, so the extension on the id always matches the language of
 * the code. Without it `$app/mount.js` keeps its `.js` id while the loaded
 * source is TypeScript, and rolldown fails to parse it.
 */
export function virtualId(virtual: string): string | undefined {
  const fileName = virtualFileName(virtual)
  return fileName ? `/$app/${fileName}` : undefined
}

export function resolveConvention(viteRoot: string, virtual: string): string | undefined {
  const candidates = conventions[stripExt(virtual)]
  if (!candidates) {
    return undefined
  }
  for (const candidate of candidates) {
    const path = resolve(viteRoot, candidate)
    if (existsSync(path)) {
      return path
    }
  }
  return undefined
}

export function loadVirtualModule(virtual: string): { code: string; map: null } | undefined {
  const fileName = virtualFileName(virtual)
  if (!fileName) {
    return undefined
  }
  return { code: readFileSync(resolve(virtualRoot, fileName), 'utf8'), map: null }
}

import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { bunvue } from '../src/plugin/index.ts'
import { loadVirtualModule, virtualFileName, virtualId } from '../src/plugin/virtual.ts'
import { buildExample, exampleRoot } from './helpers.ts'

type ResolveId = (id: string) => string | undefined

/** The `bunvue:virtual` plugin with its `configResolved` hook already run. */
function resolveIdWithRoot(root: string): ResolveId {
  const plugin = bunvue().find((entry) => entry.name === 'bunvue:virtual') as Plugin
  ;(plugin.configResolved as (config: { root: string }) => void)({ root })
  return plugin.resolveId as unknown as ResolveId
}

/** A Vite root with no convention files, so the placeholders always win. */
const emptyRoot = join(exampleRoot, 'client', 'pages')

describe('$app virtual module ids', () => {
  it('resolves a .js request to the extension of the file it loads', () => {
    const resolveId = resolveIdWithRoot(emptyRoot)
    expect(resolveId('/$app/mount.js')).toBe('/$app/mount.ts')
    expect(resolveId('$app/mount.js')).toBe('/$app/mount.ts')
    expect(resolveId('/$app/routes.js')).toBe('/$app/routes.ts')
    expect(resolveId('/$app/router.vue')).toBe('/$app/router.vue')
  })

  it('gives an extensionless request the same id as its .ts and .js forms', () => {
    const resolveId = resolveIdWithRoot(emptyRoot)
    expect(resolveId('/$app/root')).toBe('/$app/root.ts')
    expect(resolveId('/$app/root.ts')).toBe('/$app/root.ts')
    expect(resolveId('/$app/root.js')).toBe('/$app/root.ts')
  })

  it('loads the resolved id, so the code matches the extension', () => {
    const resolveId = resolveIdWithRoot(emptyRoot)
    const id = resolveId('/$app/mount.js')!
    expect(id.endsWith('.ts')).toBe(true)
    const loaded = loadVirtualModule(id.slice('/$app/'.length))
    expect(loaded?.code).toBe(loadVirtualModule('mount.js')!.code)
    // The placeholder is TypeScript, which is why the id may not stay `.js`.
    expect(loaded?.code).toContain(': Promise<void>')
  })

  it('lets a convention file in the Vite root win over the placeholder', () => {
    const resolveId = resolveIdWithRoot(join(exampleRoot, 'client'))
    expect(resolveId('/$app/root')).toBe(join(exampleRoot, 'client', 'root.vue'))
    expect(resolveId('/$app/context.js')).toBe(join(exampleRoot, 'client', 'context.ts'))
  })

  it('no longer resolves the modules that became library code', () => {
    const resolveId = resolveIdWithRoot(emptyRoot)
    // `create.ts` is now `createBunvueApp()` in bunvue/client, and the layout
    // lookup and its default layout live inside `$app/router.vue`.
    expect(resolveId('/$app/create.ts')).toBeUndefined()
    expect(resolveId('/$app/layout.vue')).toBeUndefined()
    expect(resolveId('/$app/layouts/default.vue')).toBeUndefined()
  })

  it('leaves an unknown $app request unresolved', () => {
    const resolveId = resolveIdWithRoot(emptyRoot)
    expect(resolveId('/$app/nope')).toBeUndefined()
    // `$app/i18n` was the i18n.config.ts module, replaced by the i18n option.
    expect(resolveId('/$app/i18n')).toBeUndefined()
    expect(virtualId('nope')).toBeUndefined()
    expect(virtualFileName('nope')).toBeUndefined()
  })
})

describe('building an app that loads $app/mount.js', () => {
  it('builds and bundles the mount script', () => {
    const indexHtml = join(exampleRoot, 'client', 'index.html')
    const original = readFileSync(indexHtml, 'utf8')
    try {
      writeFileSync(indexHtml, original.replace('/$app/mount.ts', '/$app/mount.js'))
      // Before the id carried the loaded file's extension this failed with a
      // rolldown parse error on the TypeScript in mount.ts.
      buildExample()
      const built = readFileSync(join(exampleRoot, 'dist', 'client', 'index.html'), 'utf8')
      expect(built).not.toContain('$app/mount')
      expect(built).toMatch(/<script type="module"[^>]+assets\//)
    } finally {
      writeFileSync(indexHtml, original)
      // Leave dist/ matching the fixture again for the other suites.
      buildExample()
    }
  })
})

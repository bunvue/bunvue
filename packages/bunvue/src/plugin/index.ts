import type { Plugin, ResolvedConfig, Rollup } from 'vite'
import { bunvueEnvironments } from './environments.ts'
import { bunvuePages } from './pages.ts'
import { closeBundle } from './preload.ts'
import { bunvueServerOnly } from './server-only.ts'
import { loadVirtualModule, prefix, resolveConvention, virtualId } from './virtual.ts'

export { bunvueEnvironments } from './environments.ts'
export { bunvuePages } from './pages.ts'
export { bunvueServerOnly } from './server-only.ts'

/**
 * The bunvue Vite plugin: build environments plus the `$app/*` virtual module
 * namespace, the per-page preload shells and the client guard for page
 * action files.
 */
export function bunvue(): Plugin[] {
  let root = ''
  let resolvedBundle: Rollup.OutputBundle | undefined

  const virtualPlugin: Plugin = {
    name: 'bunvue:virtual',
    configResolved(config: ResolvedConfig): void {
      root = config.root
    },
    resolveId(id: string): string | undefined {
      if (!prefix.test(id)) {
        return undefined
      }
      const [, virtual] = id.split(prefix)
      if (!virtual) {
        return undefined
      }
      const convention = resolveConvention(root, virtual)
      if (convention) {
        return convention
      }
      return virtualId(virtual)
    },
    load(id: string): { code: string; map: null } | undefined {
      if (!prefix.test(id)) {
        return undefined
      }
      const [, virtual] = id.split(prefix)
      if (!virtual) {
        return undefined
      }
      return loadVirtualModule(virtual)
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx): void {
        if (ctx.bundle) {
          resolvedBundle = ctx.bundle
        }
      },
    },
    closeBundle: {
      order: 'post',
      handler() {
        const env = this.environment
        return closeBundle(
          {
            name: env.name,
            root: env.config.root,
            base: env.config.base,
            outDir: env.config.build.outDir,
            assetsInlineLimit: env.config.build.assetsInlineLimit,
          },
          resolvedBundle,
        )
      },
    },
  }

  return [bunvueEnvironments(), bunvuePages(), bunvueServerOnly(), virtualPlugin]
}

export default bunvue

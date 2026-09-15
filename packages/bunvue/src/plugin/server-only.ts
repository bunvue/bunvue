import { posix, relative } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/** A page action file, query stripped. */
const SERVER_FILE = /\.server\.(?:ts|js)$/
/** A specifier that may name one, with or without the extension. */
const SERVER_SPECIFIER = /\.server(?:\.(?:ts|js))?(?:\?.*)?$/

interface HookContext {
  environment?: { name?: string; config?: { consumer?: string } }
  resolve?: (
    id: string,
    importer?: string,
    options?: Record<string, unknown>,
  ) => Promise<{ id: string } | null>
}

function isClient(context: HookContext): boolean {
  const environment = context.environment
  if (!environment) {
    return false
  }
  return (environment.config?.consumer ?? environment.name) === 'client'
}

/** True for a `*.server.{ts,js}` file under the Vite root's `pages/`. */
export function isPageServerFile(root: string, id: string): boolean {
  const path = posix.normalize(id.split('?')[0] as string)
  return SERVER_FILE.test(path) && path.startsWith(`${root}/pages/`)
}

function serverOnlyError(root: string, id: string, importer?: string): Error {
  const file = relative(root, id.split('?')[0] as string)
  // Vite names the root index.html as the importer of a plain URL request.
  const from = importer ? relative(root, importer.split('?')[0] as string) : 'index.html'
  const by = from === 'index.html' ? '' : ` (imported by ${from})`
  return new Error(`[bunvue] ${file} is server only and cannot be imported from client code${by}`)
}

/**
 * Keeps page action files out of the client. They are loaded by the SSR entry
 * only, so a client module importing one, or a dev request for the file
 * itself, is a mistake that would ship server code to the browser. The SSR
 * environment and the module runner are untouched.
 */
export function bunvueServerOnly(): Plugin {
  let root = ''
  return {
    name: 'bunvue:server-only',
    enforce: 'pre',
    configResolved(config: ResolvedConfig): void {
      root = config.root
    },
    async resolveId(id: string, importer: string | undefined, options) {
      if (!SERVER_SPECIFIER.test(id) || !isClient(this as HookContext)) {
        return undefined
      }
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
      if (resolved && isPageServerFile(root, resolved.id)) {
        throw serverOnlyError(root, resolved.id, importer)
      }
      return undefined
    },
    load(id: string) {
      if (isClient(this as HookContext) && isPageServerFile(root, id)) {
        throw serverOnlyError(root, id)
      }
      return undefined
    },
  }
}

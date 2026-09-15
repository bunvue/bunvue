import { resolve, sep } from 'node:path'
import type { StaticOptions } from './types.ts'

const DEFAULT_MAX_AGE = 31536000

export interface StaticResolved {
  maxAge: number
  immutable: boolean
}

export function resolveStaticOptions(options: StaticOptions = {}): StaticResolved {
  return {
    maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
    immutable: options.immutable ?? true,
  }
}

export function cacheControl({ maxAge, immutable }: StaticResolved): string {
  return `public, max-age=${maxAge}${immutable ? ', immutable' : ''}`
}

/**
 * Resolves `relativePath` inside `dir`, returning `null` when the result
 * escapes `dir` (path traversal guard).
 */
export function safeResolve(dir: string, relativePath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(relativePath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) {
    return null
  }
  const full = resolve(dir, `.${decoded.startsWith('/') ? '' : '/'}${decoded}`)
  if (full !== dir && !full.startsWith(dir + sep)) {
    return null
  }
  return full
}

async function fileResponse(
  path: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return null
  }
  return new Response(file, { headers })
}

/**
 * Serves hashed build assets with long-lived cache headers. `dirs` is tried in
 * order (client assets first, then any SSR-emitted assets).
 */
export function createAssetsHandler(
  dirs: string[],
  prefix: string,
  options: StaticResolved,
): (request: Request) => Promise<Response> {
  const value = cacheControl(options)
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith(prefix)) {
      return new Response('Not Found', { status: 404 })
    }
    const rest = pathname.slice(prefix.length)
    for (const dir of dirs) {
      const path = safeResolve(dir, rest)
      if (!path) {
        break
      }
      const response = await fileResponse(path, { 'cache-control': value })
      if (response) {
        return response
      }
    }
    return new Response('Not Found', { status: 404 })
  }
}

const hasExtension = /\.[a-zA-Z0-9]+$/

/**
 * True for paths that may be served straight from `dist/client`. `index.html`,
 * the Vite metadata folder and the generated per-page shells are off limits.
 */
export function isPublicPath(pathname: string): boolean {
  if (!hasExtension.test(pathname)) {
    return false
  }
  const rest = pathname.replace(/^\/+/, '')
  if (rest === '' || rest === 'index.html') {
    return false
  }
  if (rest.startsWith('.vite/') || rest.startsWith('html/')) {
    return false
  }
  return true
}

/**
 * Serves a file from `dist/client` (public directory contents copied by Vite).
 * Returns `null` when the path is not eligible or the file does not exist.
 */
export function createPublicHandler(
  clientOutDir: string,
  base: string,
): (url: URL) => Promise<Response | null> {
  const basePrefix = base.endsWith('/') ? base : `${base}/`
  return async (url: URL): Promise<Response | null> => {
    let pathname = url.pathname
    if (basePrefix !== '/' && pathname.startsWith(basePrefix)) {
      pathname = `/${pathname.slice(basePrefix.length)}`
    }
    if (!isPublicPath(pathname)) {
      return null
    }
    const path = safeResolve(clientOutDir, pathname)
    if (!path) {
      return null
    }
    return await fileResponse(path, {})
  }
}

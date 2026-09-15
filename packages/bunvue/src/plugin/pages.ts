import type { Plugin } from 'vite'

/** A non-setup `<script>` block and its contents. */
const SCRIPT_BLOCK = /<script(?![^>]*\bsetup\b)([^>]*)>([\s\S]*?)<\/script>/gi
const SETUP_BLOCK = /<script[^>]*\bsetup\b[^>]*>/i
/** Raw page SFC ids: under `pages/`, no query. */
const PAGE_ID = /\/pages\/[^?]*\.vue$/

const DEFAULT_EXPORT = /export\s+default\b|export\s*\{[^}]*\bdefault\b[^}]*\}/

export function needsDefaultExport(source: string): boolean {
  if (SETUP_BLOCK.test(source)) {
    // `<script setup>` always compiles to a default export.
    return false
  }
  SCRIPT_BLOCK.lastIndex = 0
  const match = SCRIPT_BLOCK.exec(source)
  if (!match) {
    // Template-only pages get their default export from the SFC compiler.
    return false
  }
  return !DEFAULT_EXPORT.test(match[2])
}

/**
 * Appends `export default {}` to the `<script>` block, on the line the closing
 * tag already occupies so source line numbers are untouched.
 */
export function injectDefaultExport(source: string): string {
  SCRIPT_BLOCK.lastIndex = 0
  return source.replace(SCRIPT_BLOCK, (block, attrs: string, body: string) => {
    if (DEFAULT_EXPORT.test(body)) {
      return block
    }
    return `<script${attrs}>${body};export default {}</script>`
  })
}

/**
 * Rollup refuses a `<script>` block that only has named exports with
 * `MISSING_EXPORT`, because the SFC compiler still imports a default from it.
 * A page that only declares `export const serverOnly = true` is perfectly
 * reasonable, so bunvue supplies the empty default component itself.
 */
export function bunvuePages(): Plugin {
  return {
    name: 'bunvue:pages',
    enforce: 'pre',
    // Only the raw SFC, never the `?vue&type=script` sub-requests.
    transform(code: string, id: string): { code: string; map: null } | undefined {
      if (!PAGE_ID.test(id) || !needsDefaultExport(code)) {
        return undefined
      }
      return { code: injectDefaultExport(code), map: null }
    },
  }
}

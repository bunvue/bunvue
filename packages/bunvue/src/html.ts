import { prepareTemplate, type PreparedTemplate } from '@unhead/vue/server'

/**
 * Strips every `<script type="module">` from an index.html so the server-only
 * shell loads no hydration bundle. Runs once per shell at startup, not per
 * request, and leaves everything else in the document byte for byte.
 */
export function removeHtmlModuleScripts(source: string): string {
  return new HTMLRewriter()
    .on('script[type="module" i]', {
      element(element) {
        element.remove()
      },
    })
    .transform(source)
}

export const ELEMENT_MARKER = '<!-- element -->'
export const HYDRATION_MARKER = '<!-- hydration -->'
/**
 * unhead's streaming template splitter only recognises `<!--app-html-->` and
 * `<!--ssr-outlet-->`, so the streaming variant of a shell carries that marker
 * where the universal one carries `<!-- element -->`.
 */
export const SSR_OUTLET_MARKER = '<!--app-html-->'

export interface HtmlShells {
  universal: PreparedTemplate
  serverOnly: PreparedTemplate
  /** Same document, with the element marker rewritten for unhead streaming. */
  streaming: PreparedTemplate
}

/**
 * Prepares the two shell variants for a page. Both keep the `<!-- element -->`
 * and `<!-- hydration -->` markers intact, so unhead parses each shell once
 * (`prepareTemplate`) and the per-request work is a head transform plus two
 * string splices instead of a full-document scan.
 */
export function createHtmlShells(source: string): HtmlShells {
  return {
    universal: prepareTemplate(source),
    serverOnly: prepareTemplate(removeHtmlModuleScripts(source)),
    streaming: prepareTemplate(source.replace(ELEMENT_MARKER, SSR_OUTLET_MARKER)),
  }
}

/** Splits a transformed shell around `<!-- element -->`. */
export function splitShell(html: string): { head: string; tail: string } {
  const index = html.indexOf(ELEMENT_MARKER)
  if (index === -1) {
    return { head: html, tail: '' }
  }
  return { head: html.slice(0, index), tail: html.slice(index + ELEMENT_MARKER.length) }
}

/** Replaces the `<!-- hydration -->` marker in a shell tail. */
export function spliceHydration(tail: string, hydration: string): string {
  const index = tail.indexOf(HYDRATION_MARKER)
  if (index === -1) {
    return tail
  }
  return tail.slice(0, index) + hydration + tail.slice(index + HYDRATION_MARKER.length)
}

/** Splices the rendered body and hydration script into a transformed shell. */
export function spliceShell(html: string, body: string, hydration: string): string {
  const { head, tail } = splitShell(html)
  return head + body + spliceHydration(tail, hydration)
}

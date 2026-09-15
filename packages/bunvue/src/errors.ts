export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ErrorParts {
  name: string
  message: string
  stack: string
  frame?: string
  cause?: ErrorParts
}

/** Vite decorates SSR errors with `id`, `frame` and `loc`. */
interface ViteError extends Error {
  id?: string
  frame?: string
  plugin?: string
  loc?: { file?: string; line?: number; column?: number }
}

function describe(error: unknown, depth = 0): ErrorParts {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error), stack: '' }
  }
  const vite = error as ViteError
  const stack = error.stack ?? ''
  // `stack` usually repeats "Name: message" on its first line, drop it so the
  // page does not show the message twice.
  const firstBreak = stack.indexOf('\n')
  const head = firstBreak === -1 ? stack : stack.slice(0, firstBreak)
  const frames =
    head.includes(error.message) && firstBreak !== -1 ? stack.slice(firstBreak + 1) : stack

  const location = vite.loc?.file
    ? `${vite.loc.file}${vite.loc.line ? `:${vite.loc.line}:${vite.loc.column ?? 0}` : ''}`
    : vite.id

  return {
    name: error.name || 'Error',
    message: location ? `${error.message}\n  at ${location}` : error.message,
    stack: frames.replace(/^\n+/, ''),
    frame: vite.frame,
    cause: depth < 3 && error.cause ? describe(error.cause, depth + 1) : undefined,
  }
}

function section(title: string, body: string): string {
  if (!body.trim()) {
    return ''
  }
  return `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(body)}</pre>`
}

function block(parts: ErrorParts, heading: string): string {
  return (
    `<h1>${escapeHtml(heading)}</h1>` +
    `<p class="message">${escapeHtml(parts.message)}</p>` +
    section('Source', parts.frame ?? '') +
    section('Stack', parts.stack) +
    (parts.cause ? block(parts.cause, `Caused by: ${parts.cause.name}`) : '')
  )
}

const STYLE = `
:root { color-scheme: light dark; }
body {
  margin: 0; padding: 2rem;
  font: 14px/1.6 ui-sans-serif, system-ui, sans-serif;
  background: #fff; color: #1b1b1b;
}
h1 { font-size: 1.15rem; margin: 0 0 .5rem; color: #b3261e; }
h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em;
     color: #6b6b6b; margin: 1.5rem 0 .35rem; font-weight: 600; }
p.message { margin: 0; font-family: ui-monospace, SFMono-Regular, monospace;
            white-space: pre-wrap; font-size: 1rem; }
pre { margin: 0; padding: .8rem 1rem; overflow-x: auto; border-radius: 6px;
      background: #f4f4f5; font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 12.5px; line-height: 1.55; }
footer { margin-top: 2rem; color: #8a8a8a; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  body { background: #17171a; color: #e6e6e6; }
  h1 { color: #ff8a80; }
  pre { background: #232327; }
}`

/**
 * Error responses. Dev mode gets a readable HTML page with the message, the
 * Vite source frame when there is one and the stack; production gets a bare
 * 500 so nothing internal leaks.
 */
export function errorResponse(error: unknown, dev: boolean): Response {
  if (!dev) {
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const parts = describe(error)
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>bunvue: ${escapeHtml(parts.name)}</title>
    <style>${STYLE}</style>
  </head>
  <body>
    ${block(parts, `${parts.name} during server-side render`)}
    <footer>bunvue dev server. This page is not shown in production.</footer>
  </body>
</html>`
  return new Response(html, {
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

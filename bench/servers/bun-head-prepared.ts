import { renderToString } from 'vue/server-renderer'
import { transformHtmlTemplate } from '@unhead/vue/server'
import { prepareTemplate } from '@unhead/vue/server'
import { createTreeWithHead, initHead, products } from '../tree/dist/entry.js'
import { shellForHead } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

await initHead()

// Unhead parses and transforms only the small shell (prepared once at startup).
// The app html and hydration are spliced in afterwards, so the 40 KB body is
// never scanned by unhead.
const PLACEHOLDER = '<!--element-->'
const prepared = prepareTemplate(shellForHead(PLACEHOLDER))

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  routes: {
    '/': {
      GET: async () => {
        const { app, head } = createTreeWithHead(products)
        const appHtml = await renderToString(app)
        const shell = await transformHtmlTemplate(head, prepared)
        const at = shell.indexOf(PLACEHOLDER)
        const html = shell.slice(0, at) + appHtml + shell.slice(at + PLACEHOLDER.length)
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
  fetch: () => new Response('not found', { status: 404 }),
})

console.log(`bun ssr+head(prepared) listening on ${server.url}`)

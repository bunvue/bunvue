import { renderToString } from 'vue/server-renderer'
import { createTree, products } from '../tree/dist/entry.js'
import { shellWithTitle } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

// `routes` is used instead of a bare `fetch` handler: it is Bun's faster
// dispatch path (static route matching, no per-request URL parsing in JS).
const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  routes: {
    '/': {
      GET: async () => {
        const appHtml = await renderToString(createTree(products))
        return new Response(shellWithTitle(appHtml), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
  fetch: () => new Response('not found', { status: 404 }),
})

console.log(`bun ssr listening on ${server.url}`)

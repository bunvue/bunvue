import { renderToString } from 'vue/server-renderer'
import { createTree, products } from '../tree/dist/entry.js'
import { shellWithTitle } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

// Control: render once at startup, then serve the identical bytes.
// Isolates the HTTP stack from the Vue renderer.
const html = shellWithTitle(await renderToString(createTree(products)))

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  routes: {
    '/': {
      GET: () =>
        new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
  },
  fetch: () => new Response('not found', { status: 404 }),
})

console.log(`bun static listening on ${server.url}`)

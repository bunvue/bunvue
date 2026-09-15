import { renderToString } from 'vue/server-renderer'
import { transformHtmlTemplate } from '@unhead/vue/server'
import { createTreeWithHead, initHead, products } from '../tree/dist/entry.js'
import { shellForHead } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

await initHead()

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  routes: {
    '/': {
      GET: async () => {
        const { app, head } = createTreeWithHead(products)
        const appHtml = await renderToString(app)
        const html = await transformHtmlTemplate(head, shellForHead(appHtml))
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
  fetch: () => new Response('not found', { status: 404 }),
})

console.log(`bun ssr+head listening on ${server.url}`)

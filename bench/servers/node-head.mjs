import Fastify from 'fastify'
import { renderToString } from 'vue/server-renderer'
import { transformHtmlTemplate } from '@unhead/vue/server'
import { createTreeWithHead, initHead, products } from '../tree/dist/entry.js'
import { shellForHead } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

await initHead()

const app = Fastify({ logger: false })

app.get('/', async (_request, reply) => {
  const { app: vueApp, head } = createTreeWithHead(products)
  const appHtml = await renderToString(vueApp)
  const html = await transformHtmlTemplate(head, shellForHead(appHtml))
  reply.type('text/html; charset=utf-8').send(html)
})

await app.listen({ port, host: '127.0.0.1' })
console.log(`node ssr+head listening on http://127.0.0.1:${port}`)

import Fastify from 'fastify'
import { renderToString } from 'vue/server-renderer'
import { createTree, products } from '../tree/dist/entry.js'
import { shellWithTitle } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

const app = Fastify({ logger: false })

app.get('/', async (_request, reply) => {
  const appHtml = await renderToString(createTree(products))
  reply.type('text/html; charset=utf-8').send(shellWithTitle(appHtml))
})

await app.listen({ port, host: '127.0.0.1' })
console.log(`node ssr listening on http://127.0.0.1:${port}`)

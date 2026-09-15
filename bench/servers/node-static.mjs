import Fastify from 'fastify'
import { renderToString } from 'vue/server-renderer'
import { createTree, products } from '../tree/dist/entry.js'
import { shellWithTitle } from './shell.mjs'

const port = Number(process.env.PORT || 3000)

// Control: render once at startup, then serve the identical bytes.
const html = shellWithTitle(await renderToString(createTree(products)))

const app = Fastify({ logger: false })

app.get('/', async (_request, reply) => {
  reply.type('text/html; charset=utf-8').send(html)
})

await app.listen({ port, host: '127.0.0.1' })
console.log(`node static listening on http://127.0.0.1:${port}`)

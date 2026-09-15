import { createBunvue, proxy } from 'bunvue'

/**
 * Minimal app whose only page is a `[slug+]` catch-all, so the tests can prove
 * that `/api/*` still outranks it in Bun's route precedence.
 */
export async function main(dev: boolean, upstream = process.env.API_URL ?? '') {
  return await createBunvue({
    root: import.meta.dirname,
    dev,
    routes: [
      proxy('/api', upstream),
      proxy('/rewrite', upstream, { rewritePrefix: '/v1' }),
      proxy('/tagged', upstream, {
        headers: (headers) => {
          headers.set('x-from-bunvue', 'yes')
          return headers
        },
        responseHeaders: (headers) => {
          headers.set('x-added-by-bunvue', 'yes')
          return headers
        },
      }),
    ],
  }).ready()
}

if (import.meta.main) {
  const app = await main(process.argv.includes('--dev'))
  const server = app.serve({ port: Number(process.env.PORT ?? 3003) })
  console.log(`bunvue listening on ${server.url}`)
}

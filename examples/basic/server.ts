import { createBunvue } from 'bunvue'

export interface AppServer {
  db: { todoList: string[] }
}

export async function main(dev: boolean) {
  return await createBunvue<AppServer>({
    root: import.meta.dirname,
    dev,
    server: {
      db: { todoList: ['Do laundry', 'Respond to emails', 'Write report'] },
    },
    // Public, JSON only, and the same object on both sides.
    runtimeConfig: {
      siteName: 'bunvue basic',
      features: { newsletter: true },
    },
    routes: [{ path: '/healthz', handler: () => Response.json({ status: 'ok' }) }],
  }).ready()
}

if (import.meta.main) {
  const app = await main(process.argv.includes('--dev'))
  const server = app.serve({ port: 3000 })
  console.log(`bunvue listening on ${server.url}`)
}

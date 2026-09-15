import { createBunvue } from 'bunvue'

export async function main(dev: boolean) {
  return await createBunvue({
    root: import.meta.dirname,
    dev,
    i18n: {
      locales: ['en', 'fi'],
      localePrefix: true,
      localeDomains: {},
    },
  }).ready()
}

if (import.meta.main) {
  const app = await main(process.argv.includes('--dev'))
  const server = app.serve({ port: Number(process.env.PORT ?? 3001) })
  console.log(`bunvue listening on ${server.url}`)
}

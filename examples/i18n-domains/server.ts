import { createBunvue } from 'bunvue'

export async function main(dev: boolean) {
  return await createBunvue({
    root: import.meta.dirname,
    dev,
    i18n: {
      locales: ['se', 'fi'],
      localePrefix: false,
      // Read at process start, so the same build serves staging and production.
      localeDomains: {
        se: process.env.SE_HOST ?? 'se.test',
        fi: process.env.FI_HOST ?? 'fi.test',
      },
    },
  }).ready()
}

if (import.meta.main) {
  const app = await main(process.argv.includes('--dev'))
  const server = app.serve({ port: Number(process.env.PORT ?? 3001) })
  console.log(`bunvue listening on ${server.url}`)
}

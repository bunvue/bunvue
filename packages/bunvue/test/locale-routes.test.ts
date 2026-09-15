import { describe, expect, it } from 'bun:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { serializedRoutes, serverRouteContext, useLocaleRoutes } from '../src/client.ts'
import type { LocaleRoutes } from '../src/client.ts'
import { expandRoutes } from '../src/server.ts'
import type { I18nConfig, RouteContextLike, RouteEntry, SerializedRoute } from '../src/types.ts'

/** The pages every table below is built from: an index, an about and a product. */
function pages(): RouteEntry[] {
  return [
    { id: '/pages/index.vue', name: 'index', path: '/', key: '', meta: {} },
    { id: '/pages/about.vue', name: 'about', path: '/about', key: '', meta: {} },
    {
      id: '/pages/product/[slug].vue',
      name: 'product',
      path: '/product/:slug',
      key: '',
      meta: {},
      i18n: { se: '/produkt/:slug', fi: '/tuote/:slug' },
    },
  ]
}

function table(i18n: I18nConfig): SerializedRoute[] {
  return expandRoutes(pages(), i18n).toJSON()
}

const prefixTable = table({ locales: ['en', 'fi'], localePrefix: true })
const domainTable = table({
  locales: ['se', 'fi'],
  localeDomains: { se: 'se.test', fi: 'fi.test' },
})

/**
 * Renders one component that calls the composable and hands back what it got.
 * The server side path is the one under test here: `renderToString` needs no
 * DOM, and the injected context stands in for the per-request one.
 */
async function localeRoutes(
  routes: SerializedRoute[],
  path: string,
  url = 'https://example.test',
): Promise<LocaleRoutes> {
  const records = routes.map((route) => ({ ...route, component: { render: () => null } }))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: records as unknown as RouteRecordRaw[],
  })
  await router.push(path)
  await router.isReady()

  const ctx = {
    url: new URL(path, url),
    params: {},
    meta: router.currentRoute.value.meta,
  } as unknown as RouteContextLike

  let api: LocaleRoutes | undefined
  const app = createSSRApp({
    setup() {
      api = useLocaleRoutes()
      return () => h('div')
    },
  })
  app.provide(serializedRoutes, routes)
  app.provide(serverRouteContext, ctx)
  app.use(router)
  await renderToString(app)
  return api as LocaleRoutes
}

describe('useLocaleRoutes with a locale prefix', () => {
  it('lists the locales in table order, the default one first', async () => {
    const { locale, locales } = await localeRoutes(prefixTable, '/')
    expect(locales).toEqual(['en', 'fi'])
    expect(locale).toBe('en')
  })

  it('reads the locale of the matched route', async () => {
    expect((await localeRoutes(prefixTable, '/fi/about')).locale).toBe('fi')
  })

  it('keeps the default locale index unprefixed and prefixes the others', async () => {
    const { localeHref } = await localeRoutes(prefixTable, '/')
    expect(localeHref('index', 'en')).toBe('/')
    expect(localeHref('index', 'fi')).toBe('/fi')
  })

  it('prefixes a non index path for the default locale too', async () => {
    const { localeHref } = await localeRoutes(prefixTable, '/')
    expect(localeHref('about', 'en')).toBe('/en/about')
    expect(localeHref('about', 'fi')).toBe('/fi/about')
  })

  it('defaults to the current locale', async () => {
    const { localeHref } = await localeRoutes(prefixTable, '/fi/about')
    expect(localeHref('about')).toBe('/fi/about')
  })

  it('honours the page i18n path override', async () => {
    const { localeHref } = await localeRoutes(prefixTable, '/')
    expect(localeHref({ name: 'product', params: { slug: 'x' } }, 'fi')).toBe('/fi/tuote/x')
    expect(localeHref({ name: 'product', params: { slug: 'x' } }, 'en')).toBe('/en/product/x')
  })

  it('returns a named location for a named target', async () => {
    const { localePath } = await localeRoutes(prefixTable, '/')
    expect(localePath({ name: 'product', params: { slug: 'x' }, hash: '#top' }, 'fi')).toEqual({
      name: 'fi__product',
      params: { slug: 'x' },
      query: undefined,
      hash: '#top',
    })
  })

  it('matches an unlocalised path target', async () => {
    const { localeHref } = await localeRoutes(prefixTable, '/')
    expect(localeHref('/about', 'fi')).toBe('/fi/about')
    expect(localeHref('/product/x', 'fi')).toBe('/fi/tuote/x')
    expect(localeHref('/', 'fi')).toBe('/fi')
  })

  it('accepts an already localised path and name', async () => {
    const { localeHref } = await localeRoutes(prefixTable, '/')
    expect(localeHref('/fi/tuote/x', 'en')).toBe('/en/product/x')
    expect(localeHref('fi__about', 'en')).toBe('/en/about')
  })

  it('returns an unknown target unchanged', async () => {
    const { localePath, localeHref } = await localeRoutes(prefixTable, '/')
    expect(localePath('/nowhere', 'fi')).toBe('/nowhere')
    expect(localeHref('nowhere', 'fi')).toBe('nowhere')
    expect(localePath({ name: 'nowhere' }, 'fi')).toEqual({ name: 'nowhere' })
  })

  it('switches the current page, keeping its params', async () => {
    const { switchLocalePath } = await localeRoutes(prefixTable, '/fi/tuote/x')
    expect(switchLocalePath('fi')).toBe('/fi/tuote/x')
    expect(switchLocalePath('en')).toBe('/en/product/x')
  })

  it('takes params for a translated slug', async () => {
    const { switchLocalePath } = await localeRoutes(prefixTable, '/fi/tuote/x')
    expect(switchLocalePath('en', { slug: 'y' })).toBe('/en/product/y')
  })

  it('keeps the query and the hash of the current page', async () => {
    const { switchLocalePath } = await localeRoutes(prefixTable, '/fi/about?page=2#top')
    expect(switchLocalePath('en')).toBe('/en/about?page=2#top')
  })
})

describe('useLocaleRoutes with locale domains', () => {
  it('links to another locale host absolutely, on the current port', async () => {
    const { localeHref } = await localeRoutes(domainTable, '/produkt/x', 'http://se.test:3001')
    expect(localeHref({ name: 'product', params: { slug: 'x' } }, 'fi')).toBe(
      'http://fi.test:3001/tuote/x',
    )
    expect(localeHref('about', 'fi')).toBe('http://fi.test:3001/about')
  })

  it('leaves a link on the current host relative', async () => {
    const { localeHref, switchLocalePath } = await localeRoutes(
      domainTable,
      '/produkt/x',
      'http://se.test:3001',
    )
    expect(localeHref({ name: 'product', params: { slug: 'x' } }, 'se')).toBe('/produkt/x')
    expect(switchLocalePath('se')).toBe('/produkt/x')
  })

  it('drops the port when the request has none', async () => {
    const { switchLocalePath } = await localeRoutes(domainTable, '/produkt/x', 'https://se.test')
    expect(switchLocalePath('fi')).toBe('https://fi.test/tuote/x')
  })

  it('matches a path target against the unprefixed paths', async () => {
    const { localeHref, locales } = await localeRoutes(domainTable, '/about', 'http://se.test:3001')
    expect(locales).toEqual(['se', 'fi'])
    expect(localeHref('/produkt/x', 'fi')).toBe('http://fi.test:3001/tuote/x')
  })
})

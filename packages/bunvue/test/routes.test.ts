import { describe, expect, it, spyOn } from 'bun:test'
import { createRoutes, expandRoutes, baseNameAndPath } from '../src/server.ts'
import {
  buildAppRoutes,
  groupRoutesByPattern,
  normalizeParams,
  selectCandidate,
  toBunPattern,
} from '../src/routes.ts'
import type { I18nConfig, RouteEntry } from '../src/types.ts'

type Glob = Record<string, () => Promise<Record<string, unknown>>>

function glob(pages: Record<string, Record<string, unknown>>): Glob {
  return Object.fromEntries(
    Object.entries(pages).map(([path, exports]) => [
      path,
      () => Promise.resolve({ default: {}, ...exports }),
    ]),
  )
}

async function build(
  pages: Record<string, Record<string, unknown>>,
  i18n?: I18nConfig,
  actions?: Record<string, Record<string, unknown>>,
) {
  const routes = await createRoutes(
    Promise.resolve({ default: glob(pages) }),
    actions ? Promise.resolve({ default: glob(actions) }) : undefined,
  )
  return expandRoutes(routes, i18n)
}

describe('baseNameAndPath', () => {
  it('derives names and paths from page filenames', () => {
    expect(baseNameAndPath('/pages/index.vue')).toEqual({ name: 'index', path: '/' })
    expect(baseNameAndPath('/pages/using-data.vue')).toEqual({
      name: 'using-data',
      path: '/using-data',
    })
    expect(baseNameAndPath('/pages/dynamic/[id].vue')).toEqual({
      name: 'dynamic',
      path: '/dynamic/:id',
    })
    expect(baseNameAndPath('/pages/[slug+].vue')).toEqual({
      name: 'catch-all',
      path: '/:slug+',
    })
  })
})

describe('createRoutes and expandRoutes without i18n', () => {
  it('produces one route per page keyed by *__path', async () => {
    const routes = await build({
      '/pages/index.vue': {},
      '/pages/about.vue': {},
    })
    const keys = routes.map((route) => route.key).sort()
    expect(keys).toEqual(['*__/', '*__/about'])
    expect(routes.every((route) => route.host === undefined)).toBe(true)
    expect(routes.find((route) => route.path === '/')?.meta.locale).toBe('en')
  })

  it('honours a page path override', async () => {
    const routes = await build({ '/pages/about.vue': { path: '/about-us' } })
    expect(routes[0].path).toBe('/about-us')
    expect(routes[0].key).toBe('*__/about-us')
  })
})

describe('expandRoutes with localePrefix', () => {
  it('expands one route per locale, keeping the default locale at the root', async () => {
    const routes = await build(
      { '/pages/index.vue': {}, '/pages/about.vue': {} },
      { locales: ['en', 'sv'], localePrefix: true, localeDomains: {} },
    )
    const byName = Object.fromEntries(routes.map((route) => [route.name, route]))
    expect(byName['en__index'].path).toBe('/')
    expect(byName['sv__index'].path).toBe('/sv')
    // Only the index path keeps the bare '/' for the default locale, every
    // other path is prefixed.
    expect(byName['en__about'].path).toBe('/en/about')
    expect(byName['sv__about'].path).toBe('/sv/about')
    expect(byName['sv__about'].key).toBe('*__/sv/about')
    expect(byName['sv__about'].meta).toEqual({ locale: 'sv', localePrefix: true })
  })

  it('uses a page level i18n path when provided', async () => {
    const routes = await build(
      { '/pages/about.vue': { i18n: { sv: '/om-oss' } } },
      { locales: ['en', 'sv'], localePrefix: true, localeDomains: {} },
    )
    const byName = Object.fromEntries(routes.map((route) => [route.name, route]))
    expect(byName['sv__about'].path).toBe('/sv/om-oss')
    expect(byName['en__about'].path).toBe('/en/about')
  })
})

describe('expandRoutes with localeDomains', () => {
  it('constrains each locale route to its host', async () => {
    const routes = await build(
      { '/pages/about.vue': { i18n: { sv: '/om-oss' } } },
      {
        locales: ['en', 'sv'],
        localePrefix: false,
        localeDomains: { en: 'example.com', sv: 'example.se' },
      },
    )
    const byName = Object.fromEntries(routes.map((route) => [route.name, route]))
    expect(byName['en__about'].host).toBe('example.com')
    expect(byName['en__about'].key).toBe('example.com__/about')
    expect(byName['sv__about'].host).toBe('example.se')
    expect(byName['sv__about'].path).toBe('/om-oss')
    expect(byName['sv__about'].key).toBe('example.se__/om-oss')
  })
})

describe('expandRoutes', () => {
  const domains: I18nConfig = {
    locales: ['en', 'sv'],
    localePrefix: false,
    localeDomains: { en: 'example.com', sv: 'example.se' },
  }

  async function base() {
    return await createRoutes(
      Promise.resolve({ default: glob({ '/pages/index.vue': {}, '/pages/about.vue': {} }) }),
    )
  }

  it('leaves the base table alone, so the same entries expand twice alike', async () => {
    const routes = await base()
    const first = expandRoutes(routes, domains).toJSON()
    const second = expandRoutes(routes, domains).toJSON()
    expect(second).toEqual(first)
    // The base entries kept their wildcard keys and their empty meta.
    expect(routes.map((route) => route.key).sort()).toEqual(['*__/', '*__/about'])
    expect(routes.every((route) => Object.keys(route.meta).length === 0)).toBe(true)
  })

  it('expands the same entries differently per config', async () => {
    const routes = await base()
    const hosts = expandRoutes(routes, domains).map((route) => route.host)
    expect(hosts.sort()).toEqual(['example.com', 'example.com', 'example.se', 'example.se'])

    const prefixed = expandRoutes(routes, {
      locales: ['en', 'sv'],
      localePrefix: true,
      localeDomains: {},
    })
    expect(prefixed.map((route) => route.path).sort()).toEqual([
      '/',
      '/en/about',
      '/sv',
      '/sv/about',
    ])

    const plain = expandRoutes(routes, undefined)
    expect(plain).toHaveLength(2)
    expect(plain.map((route) => route.key).sort()).toEqual(['*__/', '*__/about'])
    expect(plain.every((route) => route.host === undefined)).toBe(true)
  })
})

describe('createRoutes with page actions', () => {
  const action = () => undefined

  it('pairs a page with its sibling .server.ts file', async () => {
    const routes = await build({ '/pages/form.vue': {}, '/pages/index.vue': {} }, undefined, {
      '/pages/form.server.ts': { action },
    })
    const byName = Object.fromEntries(routes.map((route) => [route.name, route]))
    expect(byName['form'].action).toBe(action)
    expect(byName['index'].action).toBeUndefined()
  })

  it('pairs a .server.js file and nested dynamic pages', async () => {
    const routes = await build({ '/pages/items/[id].vue': {} }, undefined, {
      '/pages/items/[id].server.js': { action },
    })
    expect(routes[0].action).toBe(action)
  })

  it('keeps the action out of the serialized route table', async () => {
    const routes = await build({ '/pages/form.vue': {} }, undefined, {
      '/pages/form.server.ts': { action },
    })
    expect(routes[0].action).toBe(action)
    expect(Object.keys(routes.toJSON()[0])).not.toContain('action')
    expect(JSON.stringify(routes)).not.toContain('action')
  })

  it('gives every locale route of a page the same action', async () => {
    const routes = await build(
      { '/pages/form.vue': { i18n: { sv: '/formular' } }, '/pages/index.vue': {} },
      { locales: ['en', 'sv'], localePrefix: true, localeDomains: {} },
      { '/pages/form.server.ts': { action } },
    )
    const byName = Object.fromEntries(routes.map((route) => [route.name, route]))
    expect(byName['en__form'].path).toBe('/en/form')
    expect(byName['sv__form'].path).toBe('/sv/formular')
    expect(byName['en__form'].action).toBe(action)
    expect(byName['sv__form'].action).toBe(action)
    expect(byName['en__index'].action).toBeUndefined()
  })

  it('warns once about an action file without a page', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const actions = { '/pages/orphan-only-here.server.ts': { action } }
      await build({ '/pages/index.vue': {} }, undefined, actions)
      await build({ '/pages/index.vue': {} }, undefined, actions)
      const messages = warn.mock.calls.map((call) => String(call[0]))
      const orphan = messages.filter((message) => message.includes('orphan-only-here'))
      expect(orphan).toEqual([
        '[bunvue] pages/orphan-only-here.server.ts has no matching page and is ignored',
      ])
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps or pairs an action on the array form', async () => {
    const component = () => Promise.resolve({ default: {} })
    const routes = await createRoutes(
      Promise.resolve({
        default: [
          { id: '/pages/a.vue', path: '/a', name: 'a', key: '', meta: {}, component, action },
          { id: '/pages/b.vue', path: '/b', name: 'b', key: '', meta: {}, component },
        ] as unknown as RouteEntry[],
      }),
      Promise.resolve({ default: glob({ '/pages/b.server.ts': { action } }) }),
    )
    expect(routes.find((route) => route.path === '/a')?.action).toBe(action)
    expect(routes.find((route) => route.path === '/b')?.action).toBe(action)
  })
})

describe('toBunPattern', () => {
  it('keeps static and single param paths', () => {
    expect(toBunPattern('/')).toEqual({ pattern: '/' })
    expect(toBunPattern('/about')).toEqual({ pattern: '/about' })
    expect(toBunPattern('/dynamic/:id')).toEqual({ pattern: '/dynamic/:id' })
  })

  it('converts catch-all params to a wildcard and remembers the name', () => {
    expect(toBunPattern('/:slug+')).toEqual({ pattern: '/*', wildcardParam: 'slug' })
    expect(toBunPattern('/docs/:rest+')).toEqual({ pattern: '/docs/*', wildcardParam: 'rest' })
  })
})

describe('normalizeParams', () => {
  it('maps the wildcard param back onto its name', () => {
    expect(normalizeParams({ '*': 'a/b' }, 'slug')).toEqual({ '*': 'a/b', slug: 'a/b' })
    expect(normalizeParams({ id: '42' }, undefined)).toEqual({ id: '42' })
    expect(normalizeParams(undefined, 'slug')).toEqual({})
  })

  it('recovers the wildcard from the pathname when Bun omits it', () => {
    expect(normalizeParams({}, 'slug', '/*', '/a/b')).toEqual({ '*': 'a/b', slug: 'a/b' })
    expect(normalizeParams({}, 'slug', '/docs/*', '/docs/a%20b')).toEqual({
      '*': 'a%20b',
      slug: 'a b',
    })
  })
})

function entry(partial: Partial<RouteEntry>): RouteEntry {
  return {
    id: partial.id ?? '/pages/x.vue',
    name: partial.name ?? 'x',
    path: partial.path ?? '/x',
    key: partial.key ?? '*__/x',
    meta: partial.meta ?? {},
    host: partial.host,
  }
}

describe('selectCandidate', () => {
  const candidates = [
    entry({ name: 'en__about', host: 'example.com' }),
    entry({ name: 'sv__about', host: 'example.se' }),
    entry({ name: 'about' }),
  ]

  it('prefers a host constrained candidate', () => {
    expect(selectCandidate(candidates, 'example.se')?.name).toBe('sv__about')
  })

  it('falls back to the unconstrained candidate', () => {
    expect(selectCandidate(candidates, 'other.test')?.name).toBe('about')
  })

  it('returns nothing when every candidate is host constrained', () => {
    expect(selectCandidate(candidates.slice(0, 2), 'other.test')).toBeUndefined()
  })
})

describe('buildAppRoutes', () => {
  it('collapses routes sharing a pattern into one entry', () => {
    const routes = [
      entry({ name: 'en__about', path: '/about', host: 'example.com' }),
      entry({ name: 'sv__about', path: '/about', host: 'example.se' }),
      entry({ name: 'catch-all', path: '/:slug+' }),
    ]
    const groups = groupRoutesByPattern(routes)
    expect([...groups.keys()].sort()).toEqual(['/*', '/about'])
    expect(groups.get('/about')?.candidates).toHaveLength(2)
    expect(groups.get('/*')?.wildcardParam).toBe('slug')

    const table = buildAppRoutes(routes, () => () => new Response('ok'))
    expect(Object.keys(table).sort()).toEqual(['/*', '/about'])
    const methods = table['/about'] as Record<string, unknown>
    expect(Object.keys(methods).sort()).toEqual(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'])
  })
})

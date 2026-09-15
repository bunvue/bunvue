import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { warnStaleI18nConfig } from '../src/config.ts'
import { createServerBeforeEach, resolveRouteKey } from '../src/client.ts'
import type { BunvueApp } from '../src/index.ts'
import type { RouteContextLike, SerializedRoute } from '../src/types.ts'

const examplesRoot = resolve(import.meta.dirname, '..', '..', '..', 'examples')

interface Fixture {
  app: BunvueApp<unknown>
  origin: string
  stop: () => Promise<void>
}

function buildFixture(name: string): void {
  const result = Bun.spawnSync({
    cmd: ['bun', '--bun', 'vite', 'build', '--app'],
    cwd: resolve(examplesRoot, name),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `vite build of ${name} failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
    )
  }
}

async function startFixture(name: string): Promise<Fixture> {
  const { main } = (await import(resolve(examplesRoot, name, 'server.ts'))) as {
    main: (dev: boolean) => Promise<BunvueApp<unknown>>
  }
  const app = await main(false)
  const server = app.serve({ port: 0 })
  return {
    app,
    origin: server.url.toString().replace(/\/$/, ''),
    stop: () => app.close(),
  }
}

/** Strips the SSR comment markers so assertions read the plain markup. */
function markup(html: string): string {
  const start = html.indexOf('<div id="root">')
  const end = html.indexOf('<!-- hydration -->')
  return html.slice(start, end === -1 ? undefined : end).replace(/<!--[^>]*-->/g, '')
}

describe('i18n with locale domains', () => {
  let fixture: Fixture

  // Bun builds `request.url` from the Host header, so a plain `fetch` with a
  // `host` header is enough to exercise the locale-domain selection.
  const get = (path: string, host: string): Promise<Response> =>
    fetch(`${fixture.origin}${path}`, { headers: { host } })

  beforeAll(async () => {
    buildFixture('i18n-domains')
    fixture = await startFixture('i18n-domains')
  })

  afterAll(async () => {
    await fixture.stop()
  })

  it('renders the se domain product path with the se locale route', async () => {
    const response = await get('/produkt/x', 'se.test')
    expect(response.status).toBe(200)
    const html = markup(await response.text())
    expect(html).toContain('Locale: se')
    expect(html).toContain('Name: se__product')
    expect(html).toContain('&quot;slug&quot;:&quot;x&quot;')
    expect(html).toContain('Context slug: x')
    expect(html).toContain('Path: /produkt/x')
  })

  it('renders the fi domain product path with the fi locale route', async () => {
    const response = await get('/tuote/x', 'fi.test')
    expect(response.status).toBe(200)
    const html = markup(await response.text())
    expect(html).toContain('Locale: fi')
    expect(html).toContain('Name: fi__product')
    expect(html).toContain('Context slug: x')
  })

  it('404s a localized path on an unknown host', async () => {
    expect((await get('/produkt/x', 'other.test')).status).toBe(404)
    expect((await get('/about', 'other.test')).status).toBe(404)
  })

  it('404s a path that belongs to another locale domain', async () => {
    expect((await get('/tuote/x', 'se.test')).status).toBe(404)
    expect((await get('/produkt/x', 'fi.test')).status).toBe(404)
  })

  it('serves a shared path on both domains, picking the locale by host', async () => {
    const se = markup(await (await get('/about', 'se.test')).text())
    expect(se).toContain('Locale: se')
    expect(se).toContain('Name: se__about')

    const fi = markup(await (await get('/about', 'fi.test')).text())
    expect(fi).toContain('Locale: fi')
    expect(fi).toContain('Name: fi__about')
  })

  it('serves the index of each domain', async () => {
    expect(markup(await (await get('/', 'se.test')).text())).toContain('Name: se__index')
    expect(markup(await (await get('/', 'fi.test')).text())).toContain('Name: fi__index')
  })

  it('collapses locale domain routes sharing a path into one bun route', () => {
    const patterns = Object.keys(fixture.app.routes)
    expect(patterns).toContain('/produkt/:slug')
    expect(patterns).toContain('/tuote/:slug')
    expect(patterns).toContain('/about')
    expect(patterns.filter((pattern) => pattern === '/about')).toHaveLength(1)
  })

  it('links to another locale domain absolutely, keeping the current port', async () => {
    const port = new URL(fixture.origin).port
    const html = markup(await (await get('/produkt/x', `se.test:${port}`)).text())
    expect(html).toContain(`href="http://fi.test:${port}/tuote/x"`)
    // The link to the locale that is already being served stays relative.
    expect(html).toContain('href="/produkt/x"')
  })

  it('switches locale from a page both domains share', async () => {
    const port = new URL(fixture.origin).port
    const html = markup(await (await get('/about', `fi.test:${port}`)).text())
    expect(html).toContain(`href="http://se.test:${port}/about"`)
    expect(html).toContain('href="/about"')
  })

  it('serializes host prefixed route keys into the hydration block', async () => {
    const html = await (await get('/', 'se.test')).text()
    expect(html).toContain('"se.test__/produkt/:slug"')
    expect(html).toContain('"fi.test__/tuote/:slug"')
    expect(html).toContain('"se.test__/about"')
    expect(html).toContain('"fi.test__/about"')
  })
})

describe('i18n locale domains from the environment', () => {
  let fixture: Fixture
  const previous = process.env.SE_HOST

  const get = (path: string, host: string): Promise<Response> =>
    fetch(`${fixture.origin}${path}`, { headers: { host } })

  beforeAll(async () => {
    // The example reads its domains at startup, from the same build the suite
    // above is served from: nothing about the host is baked in.
    process.env.SE_HOST = 'se.staging.test'
    buildFixture('i18n-domains')
    fixture = await startFixture('i18n-domains')
  })

  afterAll(async () => {
    await fixture.stop()
    if (previous === undefined) {
      delete process.env.SE_HOST
    } else {
      process.env.SE_HOST = previous
    }
  })

  it('serves the se locale on the host from SE_HOST', async () => {
    const html = markup(await (await get('/produkt/x', 'se.staging.test')).text())
    expect(html).toContain('Locale: se')
    expect(html).toContain('Name: se__product')
  })

  it('no longer serves the default host', async () => {
    expect((await get('/produkt/x', 'se.test')).status).toBe(404)
  })

  it('leaves the locale that kept its default host alone', async () => {
    expect(markup(await (await get('/tuote/x', 'fi.test')).text())).toContain('Locale: fi')
  })
})

describe('a stale i18n.config.ts', () => {
  function root(withFile: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'bunvue-i18n-'))
    if (withFile) {
      writeFileSync(join(dir, 'i18n.config.ts'), 'export default {}\n')
    }
    return dir
  }

  it('warns once when the file is still in the Vite root', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const dir = root(true)
    try {
      warnStaleI18nConfig(dir)
      warnStaleI18nConfig(dir)
      expect(warn.mock.calls).toEqual([
        ['[bunvue] i18n.config.ts is no longer read, pass the i18n option to createBunvue instead'],
      ])
    } finally {
      warn.mockRestore()
    }
  })

  it('stays quiet without the file, and for a root that does not exist', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      warnStaleI18nConfig(root(false))
      warnStaleI18nConfig(join(tmpdir(), 'bunvue-i18n-missing'))
      warnStaleI18nConfig(undefined)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('i18n with a locale prefix', () => {
  let fixture: Fixture
  const get = (path: string): Promise<Response> => fetch(`${fixture.origin}${path}`)

  beforeAll(async () => {
    buildFixture('i18n-prefix')
    fixture = await startFixture('i18n-prefix')
  })

  afterAll(async () => {
    await fixture.stop()
  })

  it('keeps the default locale index at the root', async () => {
    const html = markup(await (await get('/')).text())
    expect(html).toContain('Locale: en')
    expect(html).toContain('Name: en__index')
  })

  it('serves the non default locale index under its prefix', async () => {
    const html = markup(await (await get('/fi')).text())
    expect(html).toContain('Locale: fi')
    expect(html).toContain('Name: fi__index')
  })

  it('serves a localized product path under the locale prefix', async () => {
    const html = markup(await (await get('/fi/tuote/x')).text())
    expect(html).toContain('Locale: fi')
    expect(html).toContain('Name: fi__product')
    expect(html).toContain('Context slug: x')
    expect(html).toContain('Path: /fi/tuote/x')
  })

  it('prefixes non index paths for every locale, the default one included', async () => {
    expect(markup(await (await get('/en/about')).text())).toContain('Name: en__about')
    expect(markup(await (await get('/fi/about')).text())).toContain('Name: fi__about')
    // Only the index keeps the bare root for the default locale, so an
    // unprefixed `/about` does not exist.
    expect((await get('/about')).status).toBe(404)
    // ... and neither does a bare `/en` index.
    expect((await get('/en')).status).toBe(404)
  })

  it('renders the locale switcher with the localized product paths', async () => {
    const html = markup(await (await get('/fi/tuote/x')).text())
    expect(html).toContain('href="/en/product/x"')
    expect(html).toContain('href="/fi/tuote/x"')
  })

  it('builds the nav links from the route table', async () => {
    const html = markup(await (await get('/')).text())
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/fi"')
    expect(html).toContain('href="/en/about"')
    // `localePath('about')` follows the locale of the page it is rendered on.
    expect(markup(await (await get('/fi/about')).text())).toContain('href="/fi/about"')
  })

  it('serializes wildcard route keys into the hydration block', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('"*__/fi/tuote/:slug"')
    expect(html).toContain('"*__/en/about"')
    expect(html).toContain('"*__/fi"')
  })
})

describe('resolveRouteKey', () => {
  const routeMap = {
    'se.test__/about': 'se',
    'fi.test__/about': 'fi',
    '*__/about': 'shared',
    '*__/only-shared': 'shared-only',
  }

  it('prefers a host constrained key', () => {
    expect(resolveRouteKey('se.test', '/about', routeMap)).toBe('se')
    expect(resolveRouteKey('fi.test', '/about', routeMap)).toBe('fi')
  })

  it('falls back to the wildcard key', () => {
    expect(resolveRouteKey('other.test', '/about', routeMap)).toBe('shared')
    expect(resolveRouteKey('se.test', '/only-shared', routeMap)).toBe('shared-only')
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveRouteKey('se.test', '/nope', routeMap)).toBeUndefined()
  })
})

describe('createServerBeforeEach', () => {
  function route(partial: Partial<SerializedRoute>): SerializedRoute {
    return {
      id: partial.id ?? '/pages/about.vue',
      path: partial.path ?? '/about',
      name: partial.name ?? 'about',
      key: partial.key ?? '*__/about',
      meta: partial.meta ?? {},
      host: partial.host,
    }
  }

  const routeMap: Record<string, SerializedRoute> = {
    'se.test__/about': route({ name: 'se__about', key: 'se.test__/about', host: 'se.test' }),
    'fi.test__/about': route({ name: 'fi__about', key: 'fi.test__/about', host: 'fi.test' }),
  }

  function guard(hostname: string) {
    const ctxHydration = {
      url: new URL(`https://${hostname}/about`),
    } as unknown as RouteContextLike
    return createServerBeforeEach({ routeMap, ctxHydration })
  }

  const to = (name: string) =>
    ({
      name,
      params: {},
      query: {},
      matched: [{ path: '/about' }],
    }) as never

  it('swaps in the route whose host matches the request', () => {
    expect(guard('se.test')(to('about'))).toEqual({
      name: 'se__about',
      params: {},
      query: {},
    })
    expect(guard('fi.test')(to('about'))).toEqual({
      name: 'fi__about',
      params: {},
      query: {},
    })
  })

  it('does nothing once the matched route is already the right one', () => {
    expect(guard('se.test')(to('se__about'))).toBeUndefined()
  })

  it('does nothing when no candidate matches the host', () => {
    expect(guard('other.test')(to('about'))).toBeUndefined()
  })
})

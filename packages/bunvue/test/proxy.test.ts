import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import type { BunvueApp } from '../src/index.ts'

const exampleRoot = resolve(import.meta.dirname, '..', '..', '..', 'examples', 'proxy')

interface Echo {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string | null>
  body: string
}

/** Upstream under test: echoes the request and sets a couple of headers. */
function startUpstream(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/status/304')) {
        return new Response(null, { status: 304, headers: { 'x-records': '42' } })
      }
      if (url.pathname.endsWith('/status/204')) {
        return new Response(null, { status: 204, headers: { 'x-records': '42' } })
      }
      const echo: Echo = {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: {
          host: request.headers.get('host'),
          'x-forwarded-host': request.headers.get('x-forwarded-host'),
          'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
          'x-forwarded-for': request.headers.get('x-forwarded-for'),
          'content-type': request.headers.get('content-type'),
          'x-client': request.headers.get('x-client'),
          'x-from-bunvue': request.headers.get('x-from-bunvue'),
          cookie: request.headers.get('cookie'),
        },
        body: await request.text(),
      }
      const headers = new Headers({
        'content-type': 'application/json',
        'x-records': '42',
      })
      headers.append('set-cookie', 'first=1; Path=/')
      headers.append('set-cookie', 'second=2; Path=/')
      return new Response(JSON.stringify(echo), { status: 200, headers })
    },
  })
}

describe('reverse proxy', () => {
  let upstream: ReturnType<typeof Bun.serve>
  let app: BunvueApp<unknown>
  let origin: string

  const get = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${origin}${path}`, init)

  beforeAll(async () => {
    upstream = startUpstream()

    const build = Bun.spawnSync({
      cmd: ['bun', '--bun', 'vite', 'build', '--app'],
      cwd: exampleRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (build.exitCode !== 0) {
      throw new Error(
        `vite build of examples/proxy failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
      )
    }

    const { main } = (await import(resolve(exampleRoot, 'server.ts'))) as {
      main: (dev: boolean, upstream?: string) => Promise<BunvueApp<unknown>>
    }
    app = await main(false, upstream.url.toString().replace(/\/$/, ''))
    origin = app.serve({ port: 0 }).url.toString().replace(/\/$/, '')
  })

  afterAll(async () => {
    await app.close()
    upstream.stop(true)
  })

  it('forwards a GET with its path and query string', async () => {
    const response = await get('/api/items?q=shoes&page=2')
    expect(response.status).toBe(200)
    const echo = (await response.json()) as Echo
    expect(echo.method).toBe('GET')
    expect(echo.path).toBe('/api/items')
    expect(echo.query).toEqual({ q: 'shoes', page: '2' })
  })

  it('streams a POST body upstream', async () => {
    const response = await get('/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'shoe' }),
    })
    const echo = (await response.json()) as Echo
    expect(echo.method).toBe('POST')
    expect(echo.headers['content-type']).toBe('application/json')
    expect(JSON.parse(echo.body)).toEqual({ name: 'shoe' })
  })

  it('passes custom request headers through and drops the client host', async () => {
    const echo = (await (
      await get('/api/echo', { headers: { 'x-client': 'abc', cookie: 'sid=1' } })
    ).json()) as Echo
    expect(echo.headers['x-client']).toBe('abc')
    expect(echo.headers.cookie).toBe('sid=1')
    // fetch sets the upstream host itself
    expect(echo.headers.host).not.toBe(new URL(origin).host)
    expect(echo.headers.host).toBe(new URL(upstream.url.toString()).host)
  })

  it('sets the x-forwarded-* chain', async () => {
    const echo = (await (await get('/api/echo')).json()) as Echo
    expect(echo.headers['x-forwarded-host']).toBe(new URL(origin).host)
    expect(echo.headers['x-forwarded-proto']).toBe('http')
    expect(echo.headers['x-forwarded-for']).toBeTruthy()
  })

  it('appends the client address to an existing x-forwarded-for', async () => {
    const echo = (await (
      await get('/api/echo', { headers: { 'x-forwarded-for': '203.0.113.7' } })
    ).json()) as Echo
    expect(echo.headers['x-forwarded-for']).toStartWith('203.0.113.7, ')
  })

  it('keeps a preset x-forwarded-host', async () => {
    const echo = (await (
      await get('/api/echo', { headers: { 'x-forwarded-host': 'edge.example.com' } })
    ).json()) as Echo
    expect(echo.headers['x-forwarded-host']).toBe('edge.example.com')
  })

  it('passes upstream response headers through unchanged', async () => {
    const response = await get('/api/echo')
    expect(response.headers.get('x-records')).toBe('42')
    expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/'])
  })

  it('applies the headers and responseHeaders hooks', async () => {
    const response = await get('/tagged/echo')
    expect(response.headers.get('x-added-by-bunvue')).toBe('yes')
    const echo = (await response.json()) as Echo
    expect(echo.headers['x-from-bunvue']).toBe('yes')
  })

  it('maps the prefix onto rewritePrefix', async () => {
    const echo = (await (await get('/rewrite/x?a=1')).json()) as Echo
    expect(echo.path).toBe('/v1/x')
    expect(echo.query).toEqual({ a: '1' })
  })

  it('relays a 304 without a body', async () => {
    const response = await get('/api/status/304')
    expect(response.status).toBe(304)
    expect(response.headers.get('x-records')).toBe('42')
    expect(await response.text()).toBe('')
  })

  it('relays a 204 without a body', async () => {
    const response = await get('/api/status/204')
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('never runs a proxied route through SSR', async () => {
    const response = await get('/api/echo')
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.text()).not.toContain('<div id="root">')
  })

  it('outranks the app catch-all page', async () => {
    const page = await get('/api-docs/intro')
    expect(page.headers.get('content-type')).toContain('text/html')
    const proxied = await get('/api/echo')
    expect(proxied.headers.get('content-type')).toContain('application/json')
  })

  it('renders the catch-all page with the joined slug', async () => {
    const html = await (await get('/docs/getting/started')).text()
    expect(html).toContain('Catch-all')
    expect(html).toContain('docs/getting/started')
  })
})

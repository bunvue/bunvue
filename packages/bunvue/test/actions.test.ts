import { describe, expect, it } from 'bun:test'
import { ref } from 'vue'
import type { Plugin } from 'vite'
import { createClientBeforeEach } from '../src/client.ts'
import { RouteContext, mergeResponseHeaders } from '../src/context.ts'
import { isCrossSiteRequest, resolveCsrf } from '../src/csrf.ts'
import { bunvue } from '../src/plugin/index.ts'
import { bunvueServerOnly, isPageServerFile } from '../src/plugin/server-only.ts'
import type { RouteContextLike, RouteEntry } from '../src/types.ts'

const route: RouteEntry = {
  id: '/pages/form.vue',
  name: 'form',
  path: '/form',
  key: '*__/form',
  meta: {},
}

function context(init?: RequestInit): RouteContext {
  const url = new URL('http://localhost/form')
  return new RouteContext({
    request: new Request(url, init),
    url,
    params: {},
    server: undefined,
    route,
  })
}

function form(email: string): FormData {
  const data = new FormData()
  data.set('email', email)
  return data
}

describe('reading the request body', () => {
  it('memoizes ctx.formData()', async () => {
    const ctx = context({ method: 'POST', body: form('ada@example.com') })
    const first = ctx.formData()
    expect(ctx.formData()).toBe(first)
    expect((await first).get('email')).toBe('ada@example.com')
  })

  it('memoizes ctx.json()', async () => {
    const ctx = context({
      method: 'POST',
      body: JSON.stringify({ email: 'ada@example.com' }),
      headers: { 'content-type': 'application/json' },
    })
    const first = ctx.json<{ email: string }>()
    expect(ctx.json()).toBe(first)
    expect((await first).email).toBe('ada@example.com')
  })

  it('names the reader already used when the other one is asked for', async () => {
    const ctx = context({ method: 'POST', body: form('ada@example.com') })
    await ctx.formData()
    expect(() => ctx.json()).toThrow(
      'bunvue: the request body was already read with ctx.formData(), ' +
        'it cannot be read again with ctx.json()',
    )
  })
})

describe('ctx.redirect() status', () => {
  it('defaults to 302 for GET and HEAD', () => {
    expect(context().redirect('/').response.status).toBe(302)
    expect(context({ method: 'HEAD' }).redirect('/').response.status).toBe(302)
  })

  it('defaults to 303 for every other method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(context({ method }).redirect('/').response.status).toBe(303)
    }
  })

  it('lets an explicit status win', () => {
    expect(context({ method: 'POST' }).redirect('/', 307).response.status).toBe(307)
    expect(context().redirect('/', 301).response.status).toBe(301)
  })
})

describe('merging ctx.headers into a short circuit response', () => {
  it('returns the response itself when there is nothing to merge', () => {
    const response = new Response(null, { status: 302 })
    expect(mergeResponseHeaders(response, new Headers())).toBe(response)
  })

  it('keeps headers already on the response and appends cookies', () => {
    const extra = new Headers({ 'x-a': 'ctx', 'x-b': 'ctx' })
    extra.append('set-cookie', 'a=1')
    extra.append('set-cookie', 'b=2')
    const response = new Response('body', {
      status: 201,
      statusText: 'Made',
      headers: { 'x-a': 'own', 'set-cookie': 'own=1' },
    })
    const merged = mergeResponseHeaders(response, extra)
    expect(merged.status).toBe(201)
    expect(merged.statusText).toBe('Made')
    expect(merged.headers.get('x-a')).toBe('own')
    expect(merged.headers.get('x-b')).toBe('ctx')
    expect(merged.headers.getSetCookie()).toEqual(['own=1', 'a=1', 'b=2'])
  })

  it('handles an immutable Response.redirect()', async () => {
    const extra = new Headers()
    extra.append('set-cookie', 'session=abc')
    const merged = mergeResponseHeaders(Response.redirect('http://localhost/', 303), extra)
    expect(merged.status).toBe(303)
    expect(merged.headers.get('location')).toBe('http://localhost/')
    expect(merged.headers.getSetCookie()).toEqual(['session=abc'])
  })
})

describe('actionData in the hydration payload', () => {
  it('leaves the key out when no action returned anything', () => {
    expect('actionData' in context().toJSON()).toBe(false)
  })

  it('includes it once an action returned something', () => {
    const ctx = context({ method: 'POST' })
    ctx.actionData = { errors: { email: 'Invalid' } }
    expect(ctx.toJSON().actionData).toEqual({ errors: { email: 'Invalid' } })
  })

  it('keeps the body readers off the payload', () => {
    const payload = JSON.stringify(context({ method: 'POST', body: 'x' }).toJSON())
    expect(payload).not.toContain('formData')
    expect(payload).not.toContain('body')
  })

  it('is dropped on the first client navigation', () => {
    const scope = globalThis as Record<string, unknown>
    const hadWindow = 'window' in scope
    scope.window = { location: { hostname: 'localhost', origin: 'http://localhost' } }
    try {
      const ctxHydration = {
        url: new URL('http://localhost/form'),
        params: {},
        actionData: { errors: { email: 'Invalid' } },
      } as unknown as RouteContextLike
      const guard = createClientBeforeEach({ routeMap: {}, ctxHydration }, ref('default'))
      const to = (path: string) =>
        ({ fullPath: path, params: {}, query: {}, matched: [{ path }], meta: {} }) as never
      // The hydrating navigation keeps it, so the client renders the same markup.
      guard(to('/form'))
      expect(ctxHydration.actionData).toEqual({ errors: { email: 'Invalid' } })
      guard(to('/'))
      expect(ctxHydration.actionData).toBeUndefined()
    } finally {
      if (!hadWindow) {
        delete scope.window
      }
    }
  })
})

describe('the origin check', () => {
  const url = new URL('http://localhost:3000/form')
  const request = (headers: Record<string, string>) => new Request(url, { method: 'POST', headers })
  const trusted = resolveCsrf({ trustedOrigins: ['https://www.example.com/'] }) as Set<string>

  it('is on by default and off with csrf: false', () => {
    expect(resolveCsrf(undefined)).toEqual(new Set())
    expect(resolveCsrf({})).toEqual(new Set())
    expect(resolveCsrf(false)).toBe(false)
  })

  it('normalizes trusted origins', () => {
    expect([...trusted]).toEqual(['https://www.example.com'])
  })

  it('refuses a foreign, opaque or unparsable Origin', () => {
    expect(isCrossSiteRequest(request({ origin: 'https://evil.example' }), url, trusted)).toBe(true)
    expect(isCrossSiteRequest(request({ origin: 'http://evil.example' }), url, trusted)).toBe(true)
    expect(isCrossSiteRequest(request({ origin: 'null' }), url, trusted)).toBe(true)
    expect(isCrossSiteRequest(request({ origin: 'not a url' }), url, trusted)).toBe(true)
    // Same hostname on another port is another host.
    expect(isCrossSiteRequest(request({ origin: 'http://localhost:4000' }), url, trusted)).toBe(
      true,
    )
  })

  it('accepts the request host whatever the scheme, and trusted origins', () => {
    expect(isCrossSiteRequest(request({ origin: 'http://localhost:3000' }), url, trusted)).toBe(
      false,
    )
    // Behind a TLS terminating proxy Bun sees http while the browser says https.
    expect(isCrossSiteRequest(request({ origin: 'https://localhost:3000' }), url, trusted)).toBe(
      false,
    )
    expect(isCrossSiteRequest(request({ origin: 'https://www.example.com' }), url, trusted)).toBe(
      false,
    )
  })

  it('falls back to Sec-Fetch-Site without an Origin', () => {
    expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'cross-site' }), url, trusted)).toBe(true)
    expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'same-site' }), url, trusted)).toBe(false)
  })

  it('allows a request with neither header', () => {
    expect(isCrossSiteRequest(request({}), url, trusted)).toBe(false)
  })
})

describe('the client import guard', () => {
  const root = '/app/client'

  type Hook = (this: unknown, ...args: unknown[]) => unknown

  function guard(): { resolveId: Hook; load: Hook } {
    const plugin = bunvueServerOnly()
    ;(plugin.configResolved as (config: { root: string }) => void)({ root })
    return { resolveId: plugin.resolveId as Hook, load: plugin.load as Hook }
  }

  /** A hook context whose `resolve` maps specifiers onto the fake root. */
  function hookContext(consumer: 'client' | 'server') {
    return {
      environment: { name: consumer === 'client' ? 'client' : 'ssr', config: { consumer } },
      resolve: async (id: string, importer?: string) => ({
        id: id.startsWith('/')
          ? `${root}${id}`
          : `${importer!.slice(0, importer!.lastIndexOf('/'))}/${id.replace(/^\.\//, '')}`,
      }),
    }
  }

  const client = hookContext('client')
  const ssr = hookContext('server')

  it('is part of the bunvue plugin', () => {
    expect(bunvue().map((plugin: Plugin) => plugin.name)).toContain('bunvue:server-only')
  })

  it('recognizes action files under pages only', () => {
    expect(isPageServerFile(root, `${root}/pages/form.server.ts`)).toBe(true)
    expect(isPageServerFile(root, `${root}/pages/a/[id].server.js?import`)).toBe(true)
    expect(isPageServerFile(root, `${root}/pages/form.vue`)).toBe(false)
    expect(isPageServerFile(root, `${root}/lib/db.server.ts`)).toBe(false)
  })

  it('refuses a client module importing an action file', async () => {
    const { resolveId } = guard()
    await expect(
      resolveId.call(client, './form.server.ts', `${root}/pages/form.vue`, {}) as Promise<unknown>,
    ).rejects.toThrow(
      '[bunvue] pages/form.server.ts is server only and cannot be imported from client code ' +
        '(imported by pages/form.vue)',
    )
  })

  it('refuses a direct dev request for an action file', async () => {
    const { resolveId, load } = guard()
    await expect(
      resolveId.call(client, '/pages/form.server.ts', undefined, {}) as Promise<unknown>,
    ).rejects.toThrow('pages/form.server.ts is server only')
    expect(() => load.call(client, `${root}/pages/form.server.ts?import`)).toThrow(
      '[bunvue] pages/form.server.ts is server only and cannot be imported from client code',
    )
  })

  it('leaves the SSR environment alone', async () => {
    const { resolveId, load } = guard()
    expect(
      await resolveId.call(ssr, './form.server.ts', `${root}/pages/form.vue`, {}),
    ).toBeUndefined()
    expect(load.call(ssr, `${root}/pages/form.server.ts`)).toBeUndefined()
  })

  it('leaves other client modules alone', async () => {
    const { resolveId, load } = guard()
    expect(
      await resolveId.call(client, './form.vue', `${root}/pages/index.vue`, {}),
    ).toBeUndefined()
    expect(
      await resolveId.call(client, '../lib/db.server.ts', `${root}/pages/index.vue`, {}),
    ).toBeUndefined()
    expect(load.call(client, `${root}/pages/form.vue`)).toBeUndefined()
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createBunvue } from '../src/index.ts'
import {
  buildExample,
  exampleRoot,
  readHydration,
  startExample,
  type StartedExample,
} from './helpers.ts'

let example: StartedExample
const get = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${example.origin}${path}`, init)

/** What the example's own `app.config.errorHandler` has seen so far. */
const appErrors = (): string[] =>
  ((globalThis as Record<string, unknown>).__bunvueAppErrors ?? []) as string[]

function form(email: string): FormData {
  const data = new FormData()
  data.set('email', email)
  return data
}

/** Every file under `dir`, concatenated, so a string can be searched for. */
function readTree(dir: string): string {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((file) => join(dir, file))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
}

describe('production mode', () => {
  beforeAll(async () => {
    buildExample()
    example = await startExample()
  })

  afterAll(async () => {
    await example.stop()
  })

  it('renders the index page with SSR content', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('Welcome to bunvue!')
  })

  it('renders the useHead title in the head', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('<title>Welcome to bunvue!</title>')
  })

  it('includes the hydration block in SSR pages', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('<script type="application/json" id="__bunvue__"')
    const hydration = readHydration(html)
    expect(hydration.route).toBeDefined()
    expect(Array.isArray(hydration.routes)).toBe(true)
  })

  it('serializes the hydration payload as JSON when it can', async () => {
    const html = await (await get('/')).text()
    const hydration = readHydration(html)
    expect(hydration.format).toBe('json')
    const value = hydration.route as { state: { todoList: string[] } }
    expect(value.state.todoList).toContain('Do laundry')
  })

  it('embeds no raw < in the hydration block', async () => {
    const hydration = readHydration(await (await get('/')).text())
    expect(hydration.text).not.toContain('<')
  })

  it('falls back to the devalue format when the state holds a Date', async () => {
    const html = await (await get('/?date=1')).text()
    const hydration = readHydration(html)
    expect(hydration.format).toBe('devalue')
    const value = hydration.route as {
      state: { todoList: string[]; generatedAt: Date }
    }
    expect(value.state.generatedAt).toBeInstanceOf(Date)
    expect(value.state.generatedAt.getTime()).toBe(0)
    expect(value.state.todoList).toContain('Do laundry')
    // The route table comes back through the same format.
    expect(Array.isArray(hydration.routes)).toBe(true)
  })

  it('renders a page reading state filled from ctx.server', async () => {
    const response = await get('/using-data')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Todo List')
    expect(html).toContain('Do laundry')
    expect(html).toContain('Respond to emails')
    expect(html).toContain('Write report')
    expect(html).toContain('<title>Todo List</title>')
  })

  it('renders a page reading the runtime config through useRuntimeConfig', async () => {
    const response = await get('/runtime-config')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Site name: bunvue basic')
    expect(html).toContain('Newsletter: true')
    const hydration = readHydration(html)
    expect(hydration.runtimeConfig).toEqual({
      siteName: 'bunvue basic',
      features: { newsletter: true },
    })
  })

  it('ships the runtime config as JSON even on the devalue path', async () => {
    const hydration = readHydration(await (await get('/?date=1')).text())
    expect(hydration.format).toBe('devalue')
    expect(hydration.runtimeConfig).toEqual({
      siteName: 'bunvue basic',
      features: { newsletter: true },
    })
  })

  it('ships a useHydrationData result in the payload and shares one fetch', async () => {
    const html = await (await get('/hydration-data')).text()
    expect(html).toContain('Shared: true')
    const rendered = /<p>Fetches: (\d+)<\/p>/.exec(html)?.[1]
    const value = (readHydration(html).route as { data: Record<string, { fetches: number }> }).data[
      'demo:data'
    ]
    // What the client reuses while hydrating is exactly what was rendered.
    expect(String(value.fetches)).toBe(rendered!)

    // A second request fetches again, one call further along.
    const next = await (await get('/hydration-data')).text()
    const nextValue = (readHydration(next).route as { data: Record<string, { fetches: number }> })
      .data['demo:data']
    expect(nextValue.fetches).toBe(value.fetches + 1)
  })

  it('renders a clientOnly page without SSR content but with hydration', async () => {
    const response = await get('/client-only')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('This route is rendered on the client only!')
    expect(html).toContain('id="__bunvue__"')
  })

  it('renders a serverOnly page with no mount script and no hydration', async () => {
    const response = await get('/server-only')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('This route is rendered on the server only!')
    expect(html).not.toContain('type="module"')
    expect(html).not.toContain('__bunvue__')
    expect(html).not.toContain('application/json')
  })

  it('renders dynamic routes with their params', async () => {
    const html = await (await get('/dynamic/42')).text()
    expect(html).toContain('Item ID: 42')
    expect(html).toContain('Context param: 42')
    expect(html).toContain('Path: /dynamic/42')

    const other = await (await get('/dynamic/hello-world')).text()
    expect(other).toContain('Item ID: hello-world')
  })

  it('redirects when a page calls ctx.redirect', async () => {
    const response = await get('/redirect', { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${example.origin}/`)
  })

  it('returns 404 when a page calls ctx.notFound', async () => {
    const response = await get('/missing')
    expect(response.status).toBe(404)
  })

  it('streams a streaming page', async () => {
    const response = await get('/stream')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('<h1>Streamed page</h1>')
    expect(html).toContain('This response was streamed.')
    // The head is rendered into the streamed shell by unhead's wrapStream
    expect(html).toContain('<title>Streamed page</title>')
    // ... and the hydration placeholder in the closing chunk is spliced
    expect(html).toContain('id="__bunvue__"')
    expect(readHydration(html).route).toBeDefined()
    expect(html).not.toContain('<!-- hydration -->')
    expect(html).not.toContain('<!--app-html-->')
  })

  it('delivers the streaming page in more than one chunk', async () => {
    // Through `fetch()` Bun coalesces the chunks, so the route handler is
    // called directly to observe the shell arriving before the closing HTML.
    const handlers = example.app.routes['/stream'] as Record<
      string,
      (request: Request) => Promise<Response>
    >
    const response = await handlers.GET(new Request(`${example.origin}/stream`))
    const reader = response.body!.getReader()
    const chunks: string[] = []
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toContain('<html')
    expect(chunks[0]).toContain('<title>Streamed page</title>')
    expect(chunks[0]).not.toContain('__bunvue__')
    expect(chunks[chunks.length - 1]).toContain('id="__bunvue__"')
  })

  describe('mid-render signals', () => {
    it('honours an explicit redirect status', async () => {
      const response = await get('/signals/redirect-301', { redirect: 'manual' })
      expect(response.status).toBe(301)
      expect(response.headers.get('location')).toBe(`${example.origin}/`)
      expect(await response.text()).toBe('')
    })

    it('redirects to an absolute external url', async () => {
      const response = await get('/signals/redirect-external', { redirect: 'manual' })
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('https://example.com/elsewhere')
      expect(await response.text()).toBe('')
    })

    it('leaks no html when a page redirects', async () => {
      const response = await get('/redirect', { redirect: 'manual' })
      expect(response.status).toBe(302)
      expect(await response.text()).toBe('')
    })

    it('keeps a header a page set before calling ctx.redirect()', async () => {
      const response = await get('/signals/cookie-redirect', { redirect: 'manual' })
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`${example.origin}/`)
      expect(response.headers.getSetCookie()).toEqual(['visited=1; Path=/'])
      expect(await response.text()).toBe('')
    })

    it('renders the page with a custom status when only ctx.status is set', async () => {
      const response = await get('/signals/status')
      expect(response.status).toBe(404)
      const html = await response.text()
      expect(html).toContain('<h1>Custom status</h1>')
      expect(html).toContain('id="__bunvue__"')
    })

    it('passes response headers set from a page through', async () => {
      const response = await get('/signals/cookie')
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBe('bunvue=1; Path=/')
      expect(await response.text()).toContain('<h1>Cookie</h1>')
    })

    it('aborts with 404 when a notFound signal is thrown', async () => {
      const response = await get('/signals/thrown')
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('Never rendered')
    })

    // The example's root.vue sets its own `app.config.errorHandler` in
    // `configure()`. bunvue installs its handler after that one, so signals
    // are still swallowed and real errors still reach the app.
    it('keeps swallowing signals when the app sets an error handler', async () => {
      const before = appErrors().length
      const response = await get('/signals/thrown')
      expect(response.status).toBe(404)
      expect(appErrors().length).toBe(before)
    })

    it('hands a real error to the app error handler and still answers 500', async () => {
      const response = await get('/signals/thrown-error')
      expect(response.status).toBe(500)
      expect(appErrors()).toContain('boom from a page')
    })
  })

  describe('page actions', () => {
    const post = (
      path: string,
      body?: BodyInit,
      headers: Record<string, string> = {},
    ): Promise<Response> => get(path, { method: 'POST', body, headers, redirect: 'manual' })

    it('redirects a valid submission with a 303 and no html', async () => {
      const response = await post('/form', form('ada@example.com'))
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(`${example.origin}/form?sent=1`)
      expect(await response.text()).toBe('')
    })

    it('renders an invalid submission with a 422 and hydrates the action data', async () => {
      const response = await post('/form', form('nope'))
      expect(response.status).toBe(422)
      const html = await response.text()
      expect(html).toContain('<p id="email-error">Please enter a valid email address</p>')
      expect(html).toContain('value="nope"')
      const hydration = readHydration(html)
      expect(hydration.format).toBe('json')
      expect((hydration.route as { actionData: unknown }).actionData).toEqual({
        errors: { email: 'Please enter a valid email address' },
        values: { email: 'nope' },
      })
    })

    it('leaves actionData out of a GET of the same page', async () => {
      const response = await get('/form')
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(readHydration(html).payloadText).not.toContain('actionData')
      expect(html).not.toContain('email-error')
      expect(await (await get('/form?sent=1')).text()).toContain('Thanks, you are subscribed.')
    })

    it('runs the action for every mutating method', async () => {
      const response = await get('/form', { method: 'PUT', body: form('nope') })
      expect(response.status).toBe(422)
    })

    it('answers 405 on a page without an action', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await get('/using-data', { method })
        expect(response.status).toBe(405)
        expect(response.headers.get('allow')).toBe('GET, HEAD')
      }
    })

    it('refuses a cross origin submission', async () => {
      const response = await post('/form', form('ada@example.com'), {
        origin: 'https://evil.example',
      })
      expect(response.status).toBe(403)
    })

    it('refuses Sec-Fetch-Site cross-site without an Origin', async () => {
      const response = await post('/form', form('ada@example.com'), {
        'sec-fetch-site': 'cross-site',
      })
      expect(response.status).toBe(403)
    })

    it('accepts a same origin submission', async () => {
      const response = await post('/form', form('ada@example.com'), { origin: example.origin })
      expect(response.status).toBe(303)
    })

    it('accepts the same host over https, as behind a TLS terminating proxy', async () => {
      const https = example.origin.replace(/^http:/, 'https:')
      const response = await post('/form', form('ada@example.com'), { origin: https })
      expect(response.status).toBe(303)
    })

    it('refuses a foreign http Origin and the opaque null Origin', async () => {
      for (const origin of ['http://evil.example', 'null']) {
        const response = await post('/form', form('ada@example.com'), { origin })
        expect(response.status).toBe(403)
      }
    })

    it('keeps a cookie set before ctx.redirect() in an action', async () => {
      const response = await post('/login', new FormData())
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(`${example.origin}/`)
      expect(response.headers.getSetCookie()).toEqual(['session=abc; Path=/; HttpOnly'])
    })

    it('merges ctx.headers into a Response the action returns', async () => {
      const data = new FormData()
      data.set('mode', 'response')
      const response = await post('/login', data)
      expect(response.status).toBe(201)
      expect(response.headers.get('x-login')).toBe('custom')
      expect(response.headers.getSetCookie()).toEqual([
        'theme=dark; Path=/',
        'session=abc; Path=/; HttpOnly',
      ])
      expect(await response.text()).toBe('Logged in')
    })

    it('merges ctx.headers into an immutable Response.redirect()', async () => {
      const data = new FormData()
      data.set('mode', 'static')
      const response = await post('/login', data)
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(`${example.origin}/`)
      expect(response.headers.getSetCookie()).toEqual(['session=abc; Path=/; HttpOnly'])
    })

    it('answers a real 303 from a streaming page action', async () => {
      const response = await post('/stream-form')
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(`${example.origin}/stream-form?done=1`)
      expect(await response.text()).toBe('')
    })

    it('honours an explicit redirect status from an action', async () => {
      const response = await post('/stream-form?status=307')
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(`${example.origin}/stream-form?done=1`)
    })

    it('keeps the action and its imports out of the client build', () => {
      const server = readTree(join(exampleRoot, 'dist', 'server'))
      const client = readTree(join(exampleRoot, 'dist', 'client'))
      for (const marker of ['Please enter a valid email address', 'bunvue-newsletter-list']) {
        expect(server).toContain(marker)
        expect(client).not.toContain(marker)
      }
    })

    it('skips the origin check with csrf: false and times the action', async () => {
      const app = await createBunvue({
        root: exampleRoot,
        dev: false,
        csrf: false,
        timing: true,
        server: { db: { todoList: [] } },
      }).ready()
      try {
        const handlers = app.routes['/form'] as Record<
          string,
          (request: Request) => Promise<Response>
        >
        const response = await handlers.POST(
          new Request('http://localhost/form', {
            method: 'POST',
            body: form('nope'),
            headers: { origin: 'https://evil.example' },
          }),
        )
        expect(response.status).toBe(422)
        expect(response.headers.get('server-timing')).toContain('action;dur=')
      } finally {
        await app.close()
      }
    })
  })

  it('serves build assets with immutable cache headers', async () => {
    const asset = readdirSync(join(exampleRoot, 'dist', 'client', 'assets'))[0]
    const response = await get(`/assets/${asset}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('does not serve unknown assets', async () => {
    const response = await get('/assets/nope-does-not-exist.js')
    expect(response.status).toBe(404)
  })

  it('never serves the per page html shells', async () => {
    expect((await get('/html/index.html')).status).toBe(404)
    expect((await get('/index.html')).status).toBe(404)
  })

  it('serves user routes', async () => {
    const response = await get('/healthz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns 404 for unknown paths', async () => {
    expect((await get('/definitely-not-a-page')).status).toBe(404)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BunvueApp } from '../src/index.ts'
import { isViteConnectedMessage } from '../src/dev.ts'
import { exampleRoot } from './helpers.ts'

/**
 * A page this test owns end to end: it is created, edited and deleted here, so
 * the example's own pages are never touched and the fixture is left clean.
 */
const scratchPage = join(exampleRoot, 'client', 'pages', 'hmr-scratch.vue')

/** A page and its action, owned by this test the same way. */
const actionPage = join(exampleRoot, 'client', 'pages', 'hmr-action.vue')
const actionFile = join(exampleRoot, 'client', 'pages', 'hmr-action.server.ts')

/**
 * Long enough for chokidar to report a write and for the dev runtime's settle
 * window to pass, so the next request is the one that performs the refresh.
 */
const SETTLE_WAIT_MS = 500

const page = (body: string): string => `<template>\n  <p>${body}</p>\n</template>\n`

const action = (to: string): string =>
  `export const action = (ctx: { redirect(to: string): unknown }) => ctx.redirect('${to}')\n`

const removeScratch = (): void => {
  for (const file of [scratchPage, actionPage, actionFile]) {
    rmSync(file, { force: true })
  }
}

let app: BunvueApp<unknown>
let origin: string

const get = (path: string, init?: RequestInit): Promise<Response> => fetch(`${origin}${path}`, init)

/** Refetches `path` until `predicate` holds or the deadline passes. */
async function poll(
  path: string,
  predicate: (response: Response, body: string) => boolean,
  timeoutMs = 5000,
  init?: RequestInit,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last: string
  for (;;) {
    const response = await get(path, init)
    last = await response.text()
    if (predicate(response, last)) {
      return last
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${path}\nlast body:\n${last.slice(0, 400)}`)
    }
    await Bun.sleep(100)
  }
}

describe('development mode', () => {
  beforeAll(async () => {
    removeScratch()
    const { main } = (await import(join(exampleRoot, 'server.ts'))) as {
      main: (dev: boolean) => Promise<BunvueApp<unknown>>
    }
    app = await main(true)
    const server = app.serve({ port: 0 })
    origin = server.url.toString().replace(/\/$/, '')
  })

  afterAll(async () => {
    removeScratch()
    await app.close()
  })

  it('renders the index page through the module runner', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('Welcome to bunvue!')
    expect(html).toContain('id="__bunvue__"')
  })

  it('injects the Vite client into the transformed shell', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('/@vite/client')
  })

  it('proxies the Vite client with a JavaScript content type', async () => {
    const response = await get('/@vite/client')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/javascript/)
    expect(await response.text()).toContain('createHotContext')
  })

  it('proxies page modules as compiled SFC code', async () => {
    const response = await get('/pages/index.vue')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/javascript/)
    const code = await response.text()
    expect(code).toContain('Welcome to bunvue!')
    expect(code).toContain('import.meta.hot')
  })

  it('resolves the $app virtual entry through the proxy', async () => {
    const response = await get('/$app/mount.ts')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/javascript/)
    expect(await response.text()).toContain('import')
  })

  it('serves user routes alongside the Vite proxy', async () => {
    const response = await get('/healthz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('renders a dynamic route', async () => {
    const response = await get('/dynamic/42')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('42')
  })

  it('adds, updates and removes a page without a restart', async () => {
    try {
      // Adding a page rebuilds the Bun routes table and reloads the server.
      writeFileSync(scratchPage, page('scratch v1'))
      expect(
        await poll(
          '/hmr-scratch',
          (response, body) => response.status === 200 && body.includes('scratch v1'),
        ),
      ).toContain('scratch v1')

      // Editing it comes back through the module runner on the next request.
      // The pause keeps the two writes apart: chokidar under Bun can drop a
      // change that lands within a few tens of milliseconds of the previous
      // one, which no real editor save does.
      await Bun.sleep(300)
      writeFileSync(scratchPage, page('scratch v2'))
      expect(
        await poll(
          '/hmr-scratch',
          (response, body) => response.status === 200 && body.includes('scratch v2'),
        ),
      ).toContain('scratch v2')

      // The first request after an edit runs the handler built for the
      // previous route table while the refresh swaps in a new one. It must
      // still find its route rather than answer 404 (the "flash then Not
      // Found" bug seen in the browser after every HMR reload).
      await Bun.sleep(300)
      writeFileSync(scratchPage, page('scratch v3'))
      await Bun.sleep(SETTLE_WAIT_MS)
      const first = await get('/hmr-scratch')
      expect(first.status).toBe(200)
      expect(await first.text()).toContain('scratch v3')
    } finally {
      await Bun.sleep(300)
      rmSync(scratchPage, { force: true })
    }

    // Removing it takes the route out of the table again.
    await poll('/hmr-scratch', (response) => response.status === 404)
  }, 30_000)

  it('runs a page action through the module runner', async () => {
    const data = new FormData()
    data.set('email', 'ada@example.com')
    const response = await get('/form', { method: 'POST', body: data, redirect: 'manual' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${origin}/form?sent=1`)
  })

  it('refuses to serve a page action file to the browser', async () => {
    for (const path of ['/pages/form.server.ts', '/pages/form.server.ts?import']) {
      const response = await get(path)
      expect(response.status).not.toBe(200)
      expect(await response.text()).not.toContain('Please enter a valid email address')
    }
  })

  it('adds, updates and removes a page action without a restart', async () => {
    const post: RequestInit = { method: 'POST', redirect: 'manual' }
    const redirectsTo = (to: string) => (response: Response) =>
      response.status === 303 && response.headers.get('location') === `${origin}${to}`
    try {
      writeFileSync(actionPage, page('action page'))
      await poll('/hmr-action', (response) => response.status === 200)
      await poll('/hmr-action', (response) => response.status === 405, 5000, post)

      // Same pause as above between writes that chokidar must tell apart.
      await Bun.sleep(300)
      writeFileSync(actionFile, action('/v1'))
      await poll('/hmr-action', redirectsTo('/v1'), 5000, post)

      await Bun.sleep(300)
      writeFileSync(actionFile, action('/v2'))
      await poll('/hmr-action', redirectsTo('/v2'), 5000, post)

      await Bun.sleep(300)
      rmSync(actionFile, { force: true })
      await poll('/hmr-action', (response) => response.status === 405, 5000, post)
    } finally {
      await Bun.sleep(300)
      rmSync(actionFile, { force: true })
      rmSync(actionPage, { force: true })
    }
    await poll('/hmr-action', (response) => response.status === 404)
  }, 30_000)
})

describe('the dev logger filter', () => {
  it('drops the vite hot channel greeting, colours and timestamps included', () => {
    // What Vite actually passes the logger; the prefix and tag are printed.
    expect(isViteConnectedMessage('connected.')).toBe(true)
    expect(isViteConnectedMessage('[vite] connected.')).toBe(true)
    expect(isViteConnectedMessage('[vite] (ssr) connected.')).toBe(true)
    expect(isViteConnectedMessage('\u001b[36m[vite]\u001b[39m (ssr) connected.')).toBe(true)
    expect(isViteConnectedMessage('  [vite] (client) connected  ')).toBe(true)
  })

  it('keeps every other message, warnings included', () => {
    expect(isViteConnectedMessage('[vite] page reload pages/index.vue')).toBe(false)
    expect(isViteConnectedMessage('[vite] connected. hmr update /src/x.vue')).toBe(false)
    expect(isViteConnectedMessage('[vite] warning: something is not connected.')).toBe(false)
    expect(isViteConnectedMessage(undefined)).toBe(false)
  })
})

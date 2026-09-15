import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  buildExample,
  hydrationPayload,
  readHydration,
  startExample,
  type StartedExample,
} from './helpers.ts'

let example: StartedExample
const get = (path: string): Promise<Response> => fetch(`${example.origin}${path}`)

describe('route context', () => {
  beforeAll(async () => {
    buildExample()
    example = await startExample()
  })

  afterAll(async () => {
    await example.stop()
  })

  it('exposes url, params and meta through useRouteContext', async () => {
    const html = await (await get('/dynamic/42')).text()
    expect(html).toContain('Context param: 42')
    expect(html).toContain('Path: /dynamic/42')

    const context = await (await get('/context')).text()
    expect(context).toContain('Locale: en')
    expect(context).toContain('Path: /context')
  })

  it('attaches named extras from context.ts', async () => {
    const html = await (await get('/context')).text()
    expect(html).toContain('Hello, bunvue!')
  })

  it('seeds state through state() and the context.ts default export', async () => {
    const payload = hydrationPayload(await (await get('/')).text())
    expect(payload).toContain('todoList')
    expect(payload).toContain('Do laundry')
  })

  it('keeps server only fields out of the hydration payload', async () => {
    const payload = hydrationPayload(await (await get('/context')).text())
    for (const key of ['request', 'server', 'headers', 'response', 'ssrContext']) {
      expect(payload).not.toContain(`"${key}":`)
    }
    for (const key of ['state', 'key', 'meta', 'head', 'firstRender']) {
      expect(payload).toContain(`"${key}":`)
    }
  })

  it('carries the runtime config in its own block field, not in the payload', async () => {
    const hydration = readHydration(await (await get('/runtime-config')).text())
    expect(hydration.runtimeConfig).toEqual({
      siteName: 'bunvue basic',
      features: { newsletter: true },
    })
    expect(hydration.payloadText).not.toContain('runtimeConfig')
    expect(hydration.payloadText).not.toContain('bunvue basic')
  })

  it('keeps ctx.data out of the payload until useHydrationData stored something', async () => {
    expect(hydrationPayload(await (await get('/')).text())).not.toContain('"data":')
    expect(hydrationPayload(await (await get('/hydration-data')).text())).toContain('"data":')
  })
})

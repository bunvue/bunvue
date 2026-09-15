import { describe, expect, it } from 'bun:test'
import { resolveHydrationData } from '../src/client.ts'
import { RouteContext } from '../src/context.ts'
import type { RouteContextLike, RouteEntry } from '../src/types.ts'

/**
 * `useHydrationData()` is `resolveHydrationData()` plus `useRouteContext()`,
 * so the context is passed in here instead of being injected by Vue. These run
 * under bun, where `window` is undefined, which is the server path.
 */

const route: RouteEntry = {
  id: '/pages/index.vue',
  name: 'index',
  path: '/',
  key: '*__/',
  meta: {},
}

function context(): RouteContext {
  const url = new URL('http://localhost/')
  return new RouteContext({
    request: new Request(url),
    url,
    params: {},
    server: undefined,
    route,
  })
}

const like = (ctx: RouteContext): RouteContextLike => ctx as unknown as RouteContextLike

describe('resolveHydrationData on the server', () => {
  it('runs the fetcher and stores the result on ctx.data', async () => {
    const ctx = context()
    expect(await resolveHydrationData(like(ctx), 'product:42', () => ({ id: 42 }))).toEqual({
      id: 42,
    })
    expect(ctx.data).toEqual({ 'product:42': { id: 42 } })
  })

  it('awaits an async fetcher', async () => {
    const ctx = context()
    const value = await resolveHydrationData(like(ctx), 'k', async () => {
      await Bun.sleep(1)
      return 'late'
    })
    expect(value).toBe('late')
    expect(ctx.data.k).toBe('late')
  })

  it('returns a stored value without calling the fetcher again', async () => {
    const ctx = context()
    let calls = 0
    const fetcher = (): number => ++calls
    expect(await resolveHydrationData(like(ctx), 'k', fetcher)).toBe(1)
    expect(await resolveHydrationData(like(ctx), 'k', fetcher)).toBe(1)
    expect(calls).toBe(1)
  })

  it('shares one fetch between concurrent calls with the same key', async () => {
    const ctx = context()
    let calls = 0
    const fetcher = async (): Promise<number> => {
      calls += 1
      await Bun.sleep(2)
      return calls
    }
    const [first, second] = await Promise.all([
      resolveHydrationData(like(ctx), 'k', fetcher),
      resolveHydrationData(like(ctx), 'k', fetcher),
    ])
    expect(calls).toBe(1)
    expect(first).toBe(second)
  })

  it('keeps different keys apart', async () => {
    const ctx = context()
    await resolveHydrationData(like(ctx), 'a', () => 1)
    await resolveHydrationData(like(ctx), 'b', () => 2)
    expect(ctx.data).toEqual({ a: 1, b: 2 })
  })

  it('stores a stored undefined rather than fetching again', async () => {
    const ctx = context()
    let calls = 0
    const fetcher = (): undefined => {
      calls += 1
      return undefined
    }
    await resolveHydrationData(like(ctx), 'k', fetcher)
    await resolveHydrationData(like(ctx), 'k', fetcher)
    expect(calls).toBe(1)
  })

  it('propagates a throwing fetcher and stores nothing', async () => {
    const ctx = context()
    const boom = (): never => {
      throw new Error('boom')
    }
    await expect(resolveHydrationData(like(ctx), 'k', boom)).rejects.toThrow('boom')
    expect(ctx.data).toEqual({})
    // The failed fetch is not remembered, so the next render can try again.
    expect(await resolveHydrationData(like(ctx), 'k', () => 'ok')).toBe('ok')
  })

  it('keeps the in-flight map off the context', async () => {
    const ctx = context()
    await resolveHydrationData(like(ctx), 'k', () => 1)
    expect(JSON.stringify(ctx.toJSON())).toContain('"data":{"k":1}')
    expect(Object.keys(ctx)).not.toContain('inFlight')
  })
})

describe('the hydrated context', () => {
  it('reuses a value the server shipped, without fetching', async () => {
    const hydrated = { data: { k: 'from the server' } } as unknown as RouteContextLike
    let calls = 0
    const value = await resolveHydrationData(hydrated, 'k', () => {
      calls += 1
      return 'fetched'
    })
    expect(value).toBe('from the server')
    expect(calls).toBe(0)
  })

  it('fetches again once the payload is gone, writing nothing back', async () => {
    const navigated = { data: undefined } as unknown as RouteContextLike
    expect(await resolveHydrationData(navigated, 'k', () => 'fetched')).toBe('fetched')
    expect(navigated.data).toBeUndefined()
  })
})

describe('ctx.data in the hydration payload', () => {
  it('is left out while empty', () => {
    expect(context().toJSON().data).toBeUndefined()
  })

  it('is included once it holds a key', async () => {
    const ctx = context()
    await resolveHydrationData(like(ctx), 'k', () => 1)
    expect(ctx.toJSON().data).toEqual({ k: 1 })
  })
})

import { describe, expect, it } from 'bun:test'
import { createBunvue } from '../src/index.ts'
import { RouteContext } from '../src/context.ts'
import type { RouteEntry, RuntimeConfig } from '../src/types.ts'

const route: RouteEntry = {
  id: '/pages/index.vue',
  name: 'index',
  path: '/',
  key: '*__/',
  meta: {},
}

function context(runtimeConfig?: RuntimeConfig): RouteContext {
  const url = new URL('http://localhost/')
  return new RouteContext({
    request: new Request(url),
    url,
    params: {},
    server: undefined,
    route,
    runtimeConfig,
  })
}

describe('the runtime config on the context', () => {
  it('carries the resolved config', () => {
    const config = { siteName: 'bunvue' } as RuntimeConfig
    expect(context(config).runtimeConfig).toBe(config)
  })

  it('defaults to an empty object', () => {
    expect(context().runtimeConfig).toEqual({})
  })

  it('stays out of the hydration payload, which carries it separately', () => {
    const payload = context({ siteName: 'bunvue' } as RuntimeConfig).toJSON()
    expect(payload.runtimeConfig).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('bunvue')
  })
})

describe('startup validation', () => {
  it('rejects a runtime config JSON cannot represent', () => {
    expect(() =>
      createBunvue({
        root: import.meta.dirname,
        dev: false,
        runtimeConfig: { gtm: { at: new Date(0) } } as RuntimeConfig,
      }),
    ).toThrow('bunvue: runtimeConfig.gtm is not JSON serializable')
  })

  it('accepts a plain JSON config', () => {
    expect(() =>
      createBunvue({
        root: import.meta.dirname,
        dev: false,
        runtimeConfig: { gtm: { id: 'GTM-1' } } as RuntimeConfig,
      }),
    ).not.toThrow()
  })
})

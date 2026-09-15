import { describe, expect, it } from 'bun:test'
import { parse, unflatten } from 'devalue'
import {
  escapeScriptJson,
  hydrationScript,
  jsonText,
  nonJsonPath,
  serialize,
  serializePayload,
  serializeRoutes,
  serializeRuntimeConfig,
  serializeShared,
} from '../src/serialize.ts'

/** Reads a serialized fragment back, the way the client does. */
const revive = (text: string, format: 'json' | 'devalue' = 'json'): unknown =>
  format === 'devalue' ? parse(text) : (JSON.parse(text) as unknown)

/** Parses the emitted `<script>` block the way mount.ts does. */
function readBlock(script: string): {
  format: string
  route: unknown
  routes: unknown
  runtimeConfig: unknown
} {
  const format = /data-format="([^"]+)"/.exec(script)?.[1] ?? ''
  const text = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</script>'))
  const block = JSON.parse(text) as { route: unknown; routes: unknown; runtimeConfig: unknown }
  if (format !== 'devalue') {
    return { format, ...block }
  }
  // `runtimeConfig` is plain JSON in both formats.
  return {
    format,
    route: unflatten(block.route as unknown[]),
    routes: unflatten(block.routes as unknown[]),
    runtimeConfig: block.runtimeConfig,
  }
}

const payload = (state: unknown): Record<string, unknown> => ({
  state,
  id: 'pages/index.vue',
  key: '/',
  name: 'index',
  meta: {},
  head: {},
  layout: undefined,
  firstRender: true,
  clientOnly: undefined,
  streaming: undefined,
})

describe('jsonText', () => {
  it('serializes plain JSON values', () => {
    expect(jsonText({ a: 1, b: [true, null, 'x'] })).toBe('{"a":1,"b":[true,null,"x"]}')
  })

  const rejected: Array<[string, unknown]> = [
    ['undefined property', { a: undefined }],
    ['nested undefined property', { a: { b: { c: undefined } } }],
    ['undefined in an array', { a: [1, undefined, 3] }],
    // eslint-disable-next-line no-sparse-arrays
    ['array hole', { a: [1, , 3] }],
    ['NaN', { a: NaN }],
    ['Infinity', { a: Infinity }],
    ['-Infinity', { a: -Infinity }],
    ['-0', { a: -0 }],
    ['bigint', { a: 1n }],
    ['Date', { a: new Date(0) }],
    ['Map', { a: new Map([['k', 1]]) }],
    ['Set', { a: new Set([1]) }],
    ['RegExp', { a: /x/ }],
    ['typed array', { a: new Uint8Array([1, 2]) }],
    ['class instance', { a: new (class Thing {})() }],
    ['function', { a: () => 1 }],
    ['symbol', { a: Symbol('s') }],
  ]

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(jsonText(value)).toBeUndefined()
    })
  }

  it('rejects a cycle', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(jsonText(cyclic)).toBeUndefined()
  })

  it('accepts a null prototype object', () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare.a = 1
    expect(jsonText(bare)).toBe('{"a":1}')
  })

  it('drops undefined properties with allowUndefined, but not array holes', () => {
    expect(jsonText({ a: 1, b: undefined }, { allowUndefined: true })).toBe('{"a":1}')
    expect(jsonText({ a: [1, undefined] }, { allowUndefined: true })).toBeUndefined()
    expect(jsonText({ a: new Date(0) }, { allowUndefined: true })).toBeUndefined()
  })

  it('resets allowUndefined between calls', () => {
    expect(jsonText({ a: undefined }, { allowUndefined: true })).toBe('{}')
    expect(jsonText({ a: undefined })).toBeUndefined()
  })

  it('accepts 0 and empty structures', () => {
    expect(jsonText({ a: 0, b: [], c: {}, d: null })).toBe('{"a":0,"b":[],"c":{},"d":null}')
  })
})

describe('serialize', () => {
  it('takes the JSON path for plain values', () => {
    expect(serialize({ a: 1 })).toEqual({ text: '{"a":1}', json: true })
  })

  it('falls back to devalue for the whole value', () => {
    const result = serialize({ when: new Date(0) })
    expect(result.json).toBe(false)
    expect(revive(result.text, 'devalue')).toEqual({ when: new Date(0) })
  })
})

describe('escapeScriptJson', () => {
  it('leaves safe text untouched', () => {
    const text = JSON.stringify({ a: 'quote " and \\ backslash', b: [1, 2] })
    expect(escapeScriptJson(text)).toBe(text)
  })

  it('escapes < so </script> cannot break out', () => {
    const text = escapeScriptJson(JSON.stringify({ html: '</script><script>alert(1)</script>' }))
    expect(text).not.toContain('<')
    expect(text).toContain('\\u003C')
    expect(revive(text)).toEqual({ html: '</script><script>alert(1)</script>' })
  })

  it('escapes U+2028 and U+2029', () => {
    const sep = String.fromCharCode(0x2028)
    const par = String.fromCharCode(0x2029)
    const value = { a: `line${sep}sep${par}par` }
    const text = escapeScriptJson(JSON.stringify(value))
    expect(text).not.toContain(sep)
    expect(text).not.toContain(par)
    expect(text).toContain('\\u2028')
    expect(text).toContain('\\u2029')
    expect(revive(text)).toEqual(value)
  })
})

describe('serializeShared', () => {
  it('reuses the text for the same object identity', () => {
    const shared = { strings: { hello: 'world' } }
    const first = serializeShared(shared)
    const second = serializeShared(shared)
    expect(second).toBe(first)
    expect(first.json).toBe(true)
  })

  it('reports a non-JSON object through the flag', () => {
    expect(serializeShared({ when: new Date(0) }).json).toBe(false)
  })
})

describe('serializePayload', () => {
  it('stays JSON and round trips the payload', () => {
    const shared = { hello: 'hej' }
    const result = serializePayload(payload({ strings: shared, count: 2 }))
    expect(result.format).toBe('json')
    expect(revive(result.text)).toEqual({
      state: { strings: { hello: 'hej' }, count: 2 },
      id: 'pages/index.vue',
      key: '/',
      name: 'index',
      meta: {},
      head: {},
      firstRender: true,
    })
  })

  it('reuses the memoized text for a shared state object', () => {
    const shared = { hello: 'hej' }
    const first = serializePayload(payload({ strings: shared }))
    const second = serializePayload(payload({ strings: shared }))
    expect(second.text).toBe(first.text)
  })

  it('falls back to devalue when one state key is not JSON', () => {
    const result = serializePayload(payload({ when: new Date(0), ok: 1 }))
    expect(result.format).toBe('devalue')
    const value = revive(result.text, 'devalue') as { state: { when: Date; ok: number } }
    expect(value.state.when).toEqual(new Date(0))
    expect(value.state.ok).toBe(1)
  })

  it('falls back when a non-state payload key is not JSON', () => {
    const base = payload({ ok: 1 })
    base.meta = { pattern: /x/ }
    const result = serializePayload(base)
    expect(result.format).toBe('devalue')
    const value = revive(result.text, 'devalue') as { meta: { pattern: RegExp } }
    expect(value.meta.pattern).toEqual(/x/)
  })

  it('round trips Date, Map, undefined and a shared reference through devalue', () => {
    const shared = { hello: 'hej' }
    const result = serializePayload(
      payload({
        when: new Date(0),
        lookup: new Map([['k', 1]]),
        missing: undefined,
        a: shared,
        b: shared,
      }),
    )
    expect(result.format).toBe('devalue')
    const value = revive(result.text, 'devalue') as {
      state: {
        when: Date
        lookup: Map<string, number>
        missing: undefined
        a: object
        b: object
      }
    }
    expect(value.state.when).toEqual(new Date(0))
    expect(value.state.lookup).toBeInstanceOf(Map)
    expect(value.state.lookup.get('k')).toBe(1)
    expect('missing' in value.state).toBe(true)
    expect(value.state.missing).toBeUndefined()
    // devalue keeps identity: both keys revive to the very same object.
    expect(value.state.a).toBe(value.state.b)
  })

  it('logs the offending key path once per route id in dev', () => {
    const seen: string[] = []
    const original = console.warn
    console.warn = (message: string): void => {
      seen.push(message)
    }
    try {
      const id = `pages/warn-${Math.random()}.vue`
      const state = { cache: { entries: { at: new Date(0) } } }
      serializePayload({ ...payload(state), id }, { dev: true, id })
      serializePayload({ ...payload(state), id }, { dev: true, id })
    } finally {
      console.warn = original
    }
    expect(seen.length).toBe(1)
    expect(seen[0]).toContain('route.state.cache.entries.at')
  })
})

describe('nonJsonPath', () => {
  it('names a nested key path', () => {
    expect(nonJsonPath({ a: { b: [{ c: new Date(0) }] } })).toBe('route.a.b[0].c')
  })

  it('returns undefined for plain JSON', () => {
    expect(nonJsonPath({ a: [1, 'x'] })).toBeUndefined()
  })

  it('reports a cycle', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(nonJsonPath(cyclic)).toContain('circular')
  })
})

describe('serializeRoutes', () => {
  it('carries both encodings of the route table', () => {
    const routes = [{ key: '/', id: 'pages/index.vue' }]
    const result = serializeRoutes(routes)
    expect(revive(result.json as string)).toEqual(routes)
    expect(revive(result.devalue, 'devalue')).toEqual(routes)
  })

  it('drops the optional route fields that are undefined', () => {
    const result = serializeRoutes([
      { key: '/', id: 'pages/index.vue', layout: undefined, streaming: true },
    ])
    expect(revive(result.json as string)).toEqual([
      { key: '/', id: 'pages/index.vue', streaming: true },
    ])
  })

  it('has no JSON form for a value JSON cannot represent', () => {
    const result = serializeRoutes([{ key: '/', meta: { at: new Date(0) } }])
    expect(result.json).toBeUndefined()
    expect(revive(result.devalue, 'devalue')).toEqual([{ key: '/', meta: { at: new Date(0) } }])
  })
})

describe('serializeRuntimeConfig', () => {
  it('serializes a plain JSON config', () => {
    expect(serializeRuntimeConfig({ gtm: { id: 'GTM-1' } })).toBe('{"gtm":{"id":"GTM-1"}}')
  })

  it('escapes the text for raw script content', () => {
    expect(serializeRuntimeConfig({ a: '</script>' })).not.toContain('<')
  })

  it('names the offending top level key', () => {
    expect(() => serializeRuntimeConfig({ ok: 1, gtm: { at: new Date(0) } })).toThrow(
      'bunvue: runtimeConfig.gtm is not JSON serializable',
    )
    expect(() => serializeRuntimeConfig({ gtm: undefined })).toThrow(
      'bunvue: runtimeConfig.gtm is not JSON serializable',
    )
    expect(() => serializeRuntimeConfig({ gtm: () => 1 })).toThrow(
      'bunvue: runtimeConfig.gtm is not JSON serializable',
    )
  })

  it('names a cyclic key too', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => serializeRuntimeConfig(cyclic)).toThrow(
      'bunvue: runtimeConfig.self is not JSON serializable',
    )
  })
})

describe('hydrationScript', () => {
  it('emits the runtime config as a third top level field', () => {
    const script = hydrationScript(
      payload({ a: 1 }),
      serializeRoutes([{ key: '/' }]),
      serializeRuntimeConfig({ siteName: 'bunvue' }),
    )
    expect(readBlock(script).runtimeConfig).toEqual({ siteName: 'bunvue' })
  })

  it('defaults the runtime config to an empty object', () => {
    expect(
      readBlock(hydrationScript(payload({ a: 1 }), serializeRoutes([]))).runtimeConfig,
    ).toEqual({})
  })

  it('keeps the runtime config as plain JSON on the devalue path', () => {
    const script = hydrationScript(
      payload({ when: new Date(0) }),
      serializeRoutes([{ key: '/' }]),
      serializeRuntimeConfig({ siteName: 'bunvue' }),
    )
    expect(script).toContain('data-format="devalue"')
    expect(script).toContain('"runtimeConfig":{"siteName":"bunvue"}')
    expect(readBlock(script).runtimeConfig).toEqual({ siteName: 'bunvue' })
  })

  it('emits one application/json block holding route and routes', () => {
    const script = hydrationScript(payload({ a: 1 }), serializeRoutes([{ key: '/' }]))
    expect(
      script.startsWith('<script type="application/json" id="__bunvue__" data-format="json">'),
    ).toBe(true)
    expect(script.endsWith('</script>')).toBe(true)
    const block = readBlock(script)
    expect(block.format).toBe('json')
    expect((block.route as { state: { a: number } }).state.a).toBe(1)
    expect(block.routes).toEqual([{ key: '/' }])
  })

  it('never emits a raw < inside the block', () => {
    const script = hydrationScript(
      payload({ html: '<div class="a"><span>x</span></div>' }),
      serializeRoutes([{ key: '/<x>' }]),
    )
    const text = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</script>'))
    expect(text).not.toContain('<')
  })

  it('cannot be terminated by a string value containing </script>', () => {
    const evil = '</script><script>window.pwned = 1</script>'
    const script = hydrationScript(payload({ evil }), serializeRoutes([]))
    // Exactly one opening and one closing tag: the payload did not break out.
    expect(script.split('<script').length - 1).toBe(1)
    expect(script.split('</script>').length - 1).toBe(1)
    const block = readBlock(script) as { route: { state: { evil: string } } }
    expect(block.route.state.evil).toBe(evil)
  })

  it('switches the whole block to the devalue format', () => {
    const script = hydrationScript(payload({ when: new Date(0) }), serializeRoutes([{ key: '/' }]))
    expect(script).toContain('data-format="devalue"')
    const block = readBlock(script) as { route: { state: { when: Date } }; routes: unknown }
    expect(block.route.state.when).toEqual(new Date(0))
    expect(block.routes).toEqual([{ key: '/' }])
  })

  it('uses the devalue route table when only the routes are not JSON', () => {
    const script = hydrationScript(
      payload({ a: 1 }),
      serializeRoutes([{ key: '/', at: new Date(0) }]),
    )
    expect(script).toContain('data-format="devalue"')
    const block = readBlock(script) as { route: { state: { a: number } }; routes: unknown }
    expect(block.route.state.a).toBe(1)
    expect(block.routes).toEqual([{ key: '/', at: new Date(0) }])
  })
})

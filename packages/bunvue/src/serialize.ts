import * as devalue from 'devalue'

/**
 * Hydration payload serialization.
 *
 * The payload is not executable JavaScript. It ships as the text content of a
 * single `<script type="application/json" id="__bunvue__">` element, which the
 * client reads and parses itself.
 *
 * The block holds three top level fields, `route`, `routes` and `runtimeConfig`.
 * The first two follow `data-format`, the third is always plain JSON: the
 * runtime config is validated as pure JSON once at startup.
 *
 * `devalue.stringify` handles every JavaScript value, at the cost of walking
 * the graph itself in JS. Real payloads are almost always plain JSON, where
 * `JSON.stringify` (native, and the fastest path in the runtime) does the same
 * job. So: try JSON first, fall back to devalue for the whole value when JSON
 * cannot represent it faithfully. Both forms are JSON documents, so the block
 * is always `application/json` and `data-format` says which one it holds.
 *
 * All JSON text produced here is already escaped for raw `<script>` content
 * (see `escapeScriptJson`), so the per-request work is a concatenation of
 * already-escaped fragments: the memoized shared strings and the precomputed
 * route table are escaped once, never rescanned.
 *
 * Shared objects hung on `ctx.state` (translation tables, menus, anything from
 * a TTL cache) are memoized by identity, so they are serialized once and the
 * cached text is spliced into every later payload.
 */

/** Thrown by the probe replacer when a value cannot round trip through JSON. */
const NON_JSON = Symbol('bunvue.nonJson')

export interface SerializedValue {
  /** Serialized text for the value. Plain JSON when `json` is true. */
  text: string
  /** True when `text` is JSON and may be embedded in a larger JSON document. */
  json: boolean
}

const NOT_JSON: SerializedValue = { text: '', json: false }

/**
 * Whether a raw value survives a `JSON.stringify` / `JSON.parse` round trip
 * unchanged. Everything JSON would drop (`undefined`, functions, symbols),
 * coerce (`NaN`, `Infinity`, `-0`, `Date`, typed arrays), or flatten to `{}`
 * (`Map`, `Set`, `RegExp`, class instances) is rejected.
 */
function jsonSafe(raw: unknown): boolean {
  switch (typeof raw) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      // NaN and +-Infinity serialize as null; -0 comes back as 0.
      return Number.isFinite(raw) && !Object.is(raw, -0)
    case 'object': {
      if (raw === null) {
        return true
      }
      const proto = Object.getPrototypeOf(raw) as object | null
      return proto === Object.prototype || proto === null || proto === Array.prototype
    }
    default:
      // undefined, bigint, symbol, function
      return false
  }
}

/**
 * Set for the duration of one `jsonText` call. Not reentrant, which is fine:
 * nothing inside `JSON.stringify` calls back into `jsonText`.
 */
let allowUndefinedProps = false

/**
 * A `JSON.stringify` replacer that inspects the *raw* value on the holder,
 * before `toJSON()` had a chance to run, so a `Date` is still a `Date` here.
 * Array elements are covered as well: an `undefined` element would become
 * `null`, and the holder lookup sees the `undefined`. Cycles never reach this
 * and throw a `TypeError` from `JSON.stringify` itself.
 */
function probe(this: unknown, key: string, value: unknown): unknown {
  const holder = this as Record<string, unknown>
  const raw = holder[key]
  if (raw === undefined && allowUndefinedProps && !Array.isArray(holder)) {
    // The caller accepts a dropped key, which is what JSON.stringify does.
    return value
  }
  if (!jsonSafe(raw)) {
    throw NON_JSON
  }
  return value
}

export interface JsonOptions {
  /**
   * Accept object properties whose value is `undefined`, letting
   * `JSON.stringify` drop the key. Only for shapes bunvue owns and reads with
   * optional semantics, never for app data. Array elements are still rejected,
   * because those would come back as `null`.
   */
  allowUndefined?: boolean
}

/** Characters that must not appear literally in raw `<script>` content. */
const UNSAFE = /[<\u2028\u2029]/
const UNSAFE_ALL = /[<\u2028\u2029]/g
const ESCAPES: Record<string, string> = {
  '<': '\\u003C',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/**
 * Makes JSON text safe as the raw text content of a `<script>` element.
 *
 * `<` becomes `\u003C`, a valid JSON string escape, so a `</script>` inside a
 * string value cannot terminate the element. U+2028 and U+2029 are escaped too:
 * they are plain characters in JSON but line terminators in JavaScript source,
 * and escaping them keeps the text safe wherever it ends up.
 *
 * The common case is a scan with no match and no allocation. Every fragment is
 * escaped exactly once, at the point it is produced or memoized, so the
 * assembled document is never rescanned.
 */
export function escapeScriptJson(text: string): string {
  return UNSAFE.test(text) ? text.replace(UNSAFE_ALL, (char) => ESCAPES[char] as string) : text
}

/** A JSON object key, escaped for raw script content. */
function jsonKey(key: string): string {
  return escapeScriptJson(JSON.stringify(key))
}

/**
 * JSON text for `value`, already escaped for raw `<script>` content, or
 * undefined when JSON cannot represent it.
 */
export function jsonText(value: unknown, options: JsonOptions = {}): string | undefined {
  allowUndefinedProps = options.allowUndefined === true
  try {
    return escapeScriptJson(JSON.stringify(value, probe))
  } catch (error) {
    if (error === NON_JSON || error instanceof TypeError) {
      return undefined
    }
    throw error
  } finally {
    allowUndefinedProps = false
  }
}

/**
 * devalue's reduced form for `value`: a JSON document (a flat array of nodes
 * with back references) that `devalue.parse` / `devalue.unflatten` revives.
 */
export function devalueText(value: unknown): string {
  return escapeScriptJson(devalue.stringify(value))
}

/** JSON first, devalue for the whole value when JSON cannot represent it. */
export function serialize(value: unknown): SerializedValue {
  const text = jsonText(value)
  if (text !== undefined) {
    return { text, json: true }
  }
  return { text: devalueText(value), json: false }
}

/**
 * Serialized text for one shared object, memoized by identity.
 *
 * Objects placed on `ctx.state` and shared across requests are treated as
 * immutable after their first serialization: mutating one later keeps serving
 * the text captured the first time. Only the JSON form is cached, because a
 * devalue expression cannot be embedded into the surrounding JSON document
 * anyway; a miss there is reported through the flag and the caller falls back
 * for the whole payload.
 */
const memo = new WeakMap<object, SerializedValue>()

export function serializeShared(value: object): SerializedValue {
  const hit = memo.get(value)
  if (hit) {
    return hit
  }
  const text = jsonText(value)
  const result: SerializedValue = text === undefined ? NOT_JSON : { text, json: true }
  memo.set(value, result)
  return result
}

/** Serializes `ctx.state` key by key, reusing the memo for object values. */
function serializeState(state: unknown): SerializedValue {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    const text = jsonText(state)
    return text === undefined ? NOT_JSON : { text, json: true }
  }
  const parts: string[] = []
  for (const [key, value] of Object.entries(state)) {
    let part: SerializedValue
    if (value !== null && typeof value === 'object') {
      part = serializeShared(value)
    } else {
      const text = jsonText(value)
      part = text === undefined ? NOT_JSON : { text, json: true }
    }
    if (!part.json) {
      // devalue output is a JavaScript expression and cannot be spliced into a
      // JSON document, so one non-JSON key forces the whole payload to devalue.
      return NOT_JSON
    }
    parts.push(`${jsonKey(key)}:${part.text}`)
  }
  return { text: `{${parts.join(',')}}`, json: true }
}

/** First key path under `value` that JSON cannot represent, for dev logging. */
export function nonJsonPath(
  value: unknown,
  path = 'route',
  seen = new Set<object>(),
): string | undefined {
  if (!jsonSafe(value)) {
    return path
  }
  if (value === null || typeof value !== 'object') {
    return undefined
  }
  if (seen.has(value)) {
    return `${path} (circular)`
  }
  seen.add(value)
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item])
    : Object.entries(value).map(([key, item]) => [`.${key}`, item])
  for (const [suffix, item] of entries) {
    const found = nonJsonPath(item, `${path}${suffix}`, seen)
    if (found) {
      seen.delete(value)
      return found
    }
  }
  seen.delete(value)
  return undefined
}

const warned = new Set<string>()

function warnFallback(payload: unknown, id: string): void {
  if (warned.has(id)) {
    return
  }
  warned.add(id)
  console.warn(
    `bunvue: hydration payload for ${id} is not JSON serializable ` +
      `(${nonJsonPath(payload) ?? 'unknown key'}), falling back to devalue`,
  )
}

export interface PayloadOptions {
  /** Log the offending key path once per route id. */
  dev?: boolean
  /** Route id, used to key the dev warning. */
  id?: string
}

/** Which encoding the hydration block holds, mirrored in `data-format`. */
export type HydrationFormat = 'json' | 'devalue'

/** The id of the hydration `<script>` element, shared with the client. */
export const HYDRATION_ID = '__bunvue__'

export interface SerializedPayload {
  /** JSON text for the payload, escaped for raw script content. */
  text: string
  /** The encoding of `text`. */
  format: HydrationFormat
}

/**
 * The serialized route payload. Plain JSON whenever every key survives a JSON
 * round trip, otherwise devalue's reduced form for the whole payload: one
 * non-JSON key switches the format, because that form is a single
 * self-contained array and cannot be spliced into a JSON document key by key.
 */
export function serializePayload(
  payload: Record<string, unknown>,
  options: PayloadOptions = {},
): SerializedPayload {
  const parts: string[] = []
  let json = true
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      // bunvue's own optional frame fields (layout, clientOnly, streaming).
      // Dropping the key is exactly what JSON.stringify does, and the client
      // reads all of them with optional semantics.
      continue
    }
    const part = key === 'state' ? serializeState(value) : serialize(value)
    if (!part.json) {
      json = false
      break
    }
    parts.push(`${jsonKey(key)}:${part.text}`)
  }
  if (json) {
    return { text: `{${parts.join(',')}}`, format: 'json' }
  }
  if (options.dev) {
    warnFallback(payload, options.id ?? 'unknown route')
  }
  return { text: devalueText(payload), format: 'devalue' }
}

/**
 * The route table, serialized once at startup in both encodings.
 *
 * A serialized route carries optional fields (`layout`, `clientOnly`,
 * `serverOnly`, `streaming`, `host`) that are usually `undefined`, and the
 * client reads all of them optionally, so those keys are simply dropped.
 *
 * Both forms are kept because the block carries one `data-format` for the whole
 * document: a route payload that falls back to devalue forces the route table
 * to be read the same way, and precomputing avoids doing that work per request.
 */
export interface RoutesPayload {
  /** JSON text, or undefined when JSON cannot represent the table. */
  json: string | undefined
  /** devalue's reduced form, always available. */
  devalue: string
}

export function serializeRoutes(routes: unknown): RoutesPayload {
  return {
    json: jsonText(routes, { allowUndefined: true }),
    devalue: devalueText(routes),
  }
}

/**
 * The app's `runtimeConfig`, serialized once at startup and escaped for raw
 * script content like every other fragment.
 *
 * The config is public and pure JSON by contract, so this throws on anything
 * JSON cannot represent rather than dragging the whole block onto the devalue
 * path. The message names the offending top level key when there is one.
 */
export function serializeRuntimeConfig(config: unknown): string {
  const text = jsonText(config)
  if (text !== undefined) {
    return text
  }
  throw new Error(`bunvue: ${runtimeConfigPath(config)} is not JSON serializable`)
}

/** The offending key of a rejected runtime config, for the startup error. */
function runtimeConfigPath(config: unknown): string {
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    for (const [key, value] of Object.entries(config)) {
      if (jsonText(value) === undefined) {
        return `runtimeConfig.${key}`
      }
    }
  }
  return nonJsonPath(config, 'runtimeConfig') ?? 'runtimeConfig'
}

/**
 * The whole hydration element, built the same way on every render path.
 *
 * The text content is raw JSON, never executed, so nothing on the page can be
 * influenced by a string value in the payload. `escapeScriptJson` already ran
 * on every fragment, so this is pure concatenation.
 */
export function hydrationScript(
  payload: Record<string, unknown>,
  routesPayload: RoutesPayload,
  runtimeConfig = '{}',
  options: PayloadOptions = {},
): string {
  const route = serializePayload(payload, options)
  const json = route.format === 'json' && routesPayload.json !== undefined
  const format: HydrationFormat = json ? 'json' : 'devalue'
  const routeText = json ? route.text : devalueTextFor(route, payload)
  const routesText = json ? (routesPayload.json as string) : routesPayload.devalue
  // `runtimeConfig` is plain JSON whatever `data-format` says: it was validated
  // as such at startup, so the client reads it without going through devalue.
  return (
    `<script type="application/json" id="${HYDRATION_ID}" data-format="${format}">` +
    `{"route":${routeText},"routes":${routesText},"runtimeConfig":${runtimeConfig}}` +
    `</script>`
  )
}

/**
 * The devalue form of an already-serialized payload. Reuses the text when the
 * payload fell back on its own, and only re-serializes in the rare case where
 * the payload was fine but the route table was not.
 */
function devalueTextFor(route: SerializedPayload, payload: Record<string, unknown>): string {
  return route.format === 'devalue' ? route.text : devalueText(payload)
}

/**
 * A `ResponseSignal` carries a ready-made `Response` out of user code.
 *
 * `ctx.redirect()` and `ctx.notFound()` return one instead of throwing, so
 * a page may call them halfway through `<script setup>` and keep running,
 * but users may also `throw` it to abort early.
 *
 * The marker is a `Symbol.for()` key rather than `instanceof` so the check
 * survives module duplication between the Vite SSR bundle and the Bun-side
 * runtime.
 */
export const kResponseSignal = Symbol.for('bunvue.responseSignal')

export class ResponseSignal extends Error {
  readonly response: Response
  readonly [kResponseSignal]: true

  constructor(response: Response) {
    super(`bunvue: response signal (${response.status})`)
    this.name = 'ResponseSignal'
    this.response = response
    this[kResponseSignal] = true
  }
}

export function isResponseSignal(value: unknown): value is ResponseSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[kResponseSignal] === true
  )
}

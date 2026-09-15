import type { PageAction } from 'bunvue'

/**
 * The action runs before the streamed render starts, so the redirect is a real
 * 303 rather than a `location.replace` in the tail. `?status=307` exercises an
 * explicit status.
 */
export const action: PageAction = (ctx) => {
  const status = Number(ctx.url.searchParams.get('status')) || undefined
  return ctx.redirect('/stream-form?done=1', status)
}

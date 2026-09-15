import type { PageAction } from 'bunvue'

/**
 * Sets a session cookie on `ctx.headers`, then answers without rendering. The
 * `mode` field picks how, so each short circuit path can be seen to keep the
 * cookie: `ctx.redirect()`, an own `Response`, or an immutable
 * `Response.redirect()`.
 */
export const action: PageAction = async (ctx) => {
  const form = await ctx.formData()
  ctx.headers.append('set-cookie', 'session=abc; Path=/; HttpOnly')
  const mode = form.get('mode')
  if (mode === 'response') {
    return new Response('Logged in', {
      status: 201,
      headers: { 'x-login': 'custom', 'set-cookie': 'theme=dark; Path=/' },
    })
  }
  if (mode === 'static') {
    return Response.redirect(new URL('/', ctx.url).href, 303)
  }
  return ctx.redirect('/')
}

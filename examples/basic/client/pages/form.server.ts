import type { PageAction } from 'bunvue'
import type { AppServer } from '../../server.ts'
import type { AppState } from '../context.ts'
import { subscribe } from '../../server/newsletter.ts'

/**
 * Handles the POST of `form.vue`. Invalid input renders the page again with a
 * 422 and the errors as `actionData`, a valid address redirects with a 303.
 */
export const action: PageAction<AppServer, AppState> = async (ctx) => {
  const form = await ctx.formData()
  const email = String(form.get('email') ?? '')
  if (!email.includes('@')) {
    ctx.status = 422
    return { errors: { email: 'Please enter a valid email address' }, values: { email } }
  }
  await subscribe(email)
  return ctx.redirect('/form?sent=1')
}

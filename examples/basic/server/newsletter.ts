/**
 * A stand in for a mailing list provider. Only `pages/form.server.ts` imports
 * it, so it ends up in the SSR bundle and never in the client one.
 */
export const NEWSLETTER_LIST = 'bunvue-newsletter-list'

const subscribers = new Map<string, string>()

export async function subscribe(email: string): Promise<void> {
  subscribers.set(email, NEWSLETTER_LIST)
}

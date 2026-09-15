import { createRoutes } from 'bunvue/server'
import { createBunvueApp, type CreateBunvueAppOptions } from 'bunvue/client'
import { createHead as createServerHead } from '@unhead/vue/server'
import { createStreamableHead } from '@unhead/vue/stream/server'

import * as root from '$app/root'

/**
 * Builds the app for one request. The head is made here rather than inside
 * `createBunvueApp()` so the server-only unhead entry points stay out of the
 * client bundle. Streaming pages get unhead's streamable head, which hands
 * back `wrapStream`: the renderer uses it to emit the shell, the head patches
 * and the closing HTML around the Vue stream.
 */
async function create(options: Omit<CreateBunvueAppOptions, 'root' | 'head'>) {
  const { ctxHydration } = options
  let head
  if (ctxHydration.streaming === true) {
    const streamable = createStreamableHead()
    head = streamable.head
    ctxHydration.wrapStream = streamable.wrapStream
  } else {
    head = createServerHead()
  }
  return await createBunvueApp({ ...options, root, head })
}

export default {
  routes: createRoutes(import('$app/routes.ts'), import('$app/actions.ts')),
  create,
  context: import('$app/context.ts'),
}

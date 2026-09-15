import {
  createBunvueApp,
  extendContext,
  hydrateRoutes,
  readHydrationBlock,
  type ContextInit,
  type RouteContextLike,
  type RuntimeConfig,
} from 'bunvue/client'
import { createHead as createClientHead } from '@unhead/vue/client'
import { createStreamableHead } from '@unhead/vue/stream/client'
import routes from '$app/routes.ts'
import * as context from '$app/context.ts'
import * as root from '$app/root'

interface HydrationWindow extends Window {
  route: RouteContextLike
  routes: unknown[]
}

/** Dispatched on `document` once the globals are set, before the app mounts. */
const HYDRATED_EVENT = 'bunvue:hydrated'

async function mountApp(...targets: string[]): Promise<void> {
  const win = window as unknown as HydrationWindow
  const block = await readHydrationBlock()
  const ctxHydration = block.route as RouteContextLike
  ctxHydration.runtimeConfig = (block.runtimeConfig ?? {}) as RuntimeConfig

  // Set before anything else runs: `hydrateRoutes` reads `window.routes`, and
  // app code (inline snippets waiting on the event below, composables reading
  // `window.route`) expects both globals to exist from here on.
  win.route = ctxHydration
  win.routes = block.routes as unknown[]
  document.dispatchEvent(new CustomEvent(HYDRATED_EVENT))

  ctxHydration.url = new URL(window.location.href)
  ctxHydration.params = {}

  await extendContext(ctxHydration, context as unknown as ContextInit)

  const resolvedRoutes = await hydrateRoutes(routes)
  const routeMap = Object.fromEntries(resolvedRoutes.map((route) => [route.key, route]))

  // `createStreamableHead()` returns undefined unless unhead's streaming
  // bootstrap ran on the page, so the plain client head stays the fallback.
  const head =
    (ctxHydration.streaming === true ? createStreamableHead() : undefined) ?? createClientHead()

  const { instance, router } = await createBunvueApp({
    root,
    ctxHydration,
    routes: resolvedRoutes,
    routeMap,
    head,
  })

  ctxHydration.useHead?.push(ctxHydration.head)

  await router.isReady()

  for (const target of targets) {
    if (document.querySelector(target)) {
      instance.mount(target)
      return
    }
  }
  throw new Error(`bunvue: no mount element found from targets: ${targets.join(', ')}`)
}

if (typeof root.mount === 'string') {
  void mountApp(root.mount)
} else {
  void mountApp('#root', 'main')
}

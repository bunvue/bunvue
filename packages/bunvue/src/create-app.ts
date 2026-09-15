import { createApp, createSSRApp, reactive, ref, type App, type Component } from 'vue'
import {
  createRouter,
  type RouteRecordRaw,
  type Router,
  type RouterScrollBehavior,
} from 'vue-router'
import type { VueHeadClient } from '@unhead/vue'
import {
  attachClientNavigation,
  createClientAfterEach,
  createClientBeforeEach,
  createHistory,
  createServerBeforeEach,
  isServer,
  routeLayout,
  serializedRoutes,
  serverRouteContext,
} from './client.ts'
import { isResponseSignal } from './signal.ts'
import type { RouteContextLike, SerializedRoute } from './types.ts'

/** What `$app/root` exports: the app's root component plus its optional hooks. */
export interface RootModule {
  default: Component
  /** CSS selector the client entry mounts on. */
  mount?: string
  scrollBehavior?: RouterScrollBehavior
  configure?: (ctx: { app: App; router: Router; head: VueHeadClient }) => void | Promise<void>
}

/** Everything `createBunvueApp()` needs, gathered by the entry that calls it. */
export interface CreateBunvueAppOptions {
  root: RootModule
  routes: unknown[]
  routeMap: Record<string, SerializedRoute>
  ctxHydration: RouteContextLike
  /**
   * The unhead instance, created by the caller: the server entry makes a
   * server (or streamable server) head, the client entry a client one, so no
   * server head code is ever pulled into the browser bundle.
   */
  head: VueHeadClient
  url?: string
}

/** What the entries get back: the Vue app, its router and the hydrated state. */
export interface CreatedApp {
  instance: App
  router: Router
  state?: unknown
}

/**
 * Builds the Vue app and its router, the same way on both sides. The head is
 * handed in rather than created here, everything else, the layout ref, the
 * provides, the navigation guards and the server error handler, is wired up
 * below.
 */
export async function createBunvueApp(options: CreateBunvueAppOptions): Promise<CreatedApp> {
  const { root, routes, routeMap, ctxHydration, head } = options

  const instance = ctxHydration.clientOnly ? createApp(root.default) : createSSRApp(root.default)

  const scrollBehavior = typeof root.scrollBehavior === 'function' ? root.scrollBehavior : undefined

  const history = createHistory()
  const router = createRouter({
    history,
    routes: routes as RouteRecordRaw[],
    scrollBehavior,
  })
  const layoutRef = ref(ctxHydration.layout ?? 'default')

  instance.config.globalProperties.$isServer = isServer

  instance.use(head)
  ctxHydration.useHead = head

  instance.provide(routeLayout, layoutRef)
  // The serialized table, for `useLocaleRoutes()` and anything else that has
  // to read the route names and their locales on both sides.
  instance.provide(serializedRoutes, routes)
  if (!isServer && ctxHydration.state) {
    ctxHydration.state = reactive(ctxHydration.state)
  }

  if (isServer) {
    router.beforeEach(createServerBeforeEach({ routeMap, ctxHydration }))
    instance.provide(serverRouteContext, ctxHydration)
  } else {
    attachClientNavigation(ctxHydration, router)
    router.beforeEach(createClientBeforeEach({ routeMap }))
    router.afterEach(createClientAfterEach({ routeMap, ctxHydration }, layoutRef))
  }

  instance.use(router)

  if (typeof root.configure === 'function') {
    await root.configure({ app: instance, router, head })
  }

  if (isServer) {
    // Installed after `configure()` so an app setting its own error handler
    // cannot disable the signal capture. `ctx.redirect()` / `ctx.notFound()`
    // may be thrown from inside setup: those are not errors and are swallowed
    // here. Everything else is stashed for the renderer and handed on to the
    // app's handler, if it set one.
    const appErrorHandler = instance.config.errorHandler
    instance.config.errorHandler = (error, vm, info): void => {
      if (isResponseSignal(error)) {
        return
      }
      ctxHydration.error = error
      appErrorHandler?.(error, vm, info)
    }
  }

  return { instance, router, state: ctxHydration.state }
}

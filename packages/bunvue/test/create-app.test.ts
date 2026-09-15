import { describe, expect, it } from 'bun:test'
import { h, inject, type App, type Ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Router } from 'vue-router'
import { createHead } from '@unhead/vue/server'
import { createBunvueApp, routeLayout, serializedRoutes, ResponseSignal } from '../src/client.ts'
import type { RootModule } from '../src/client.ts'
import type { RouteContextLike, SerializedRoute } from '../src/types.ts'

/** A two entry route table, enough for the router to resolve `/`. */
const routes: SerializedRoute[] = [
  { id: '/pages/index.vue', name: 'index', path: '/', key: '*__/', meta: {} },
  { id: '/pages/about.vue', name: 'about', path: '/about', key: '*__/about', meta: {} },
]

const routeMap: Record<string, SerializedRoute> = Object.fromEntries(
  routes.map((route) => [route.key, route]),
)

/** The route records handed to vue-router, with a component that renders nothing. */
function records(): unknown[] {
  return routes.map((route) => ({ ...route, component: { render: () => null } }))
}

function context(overrides: Partial<RouteContextLike> = {}): RouteContextLike {
  return {
    url: new URL('http://example.test/'),
    params: {},
    meta: {},
    state: null,
    head: {},
    firstRender: true,
    runtimeConfig: {},
    redirect: () => undefined,
    notFound: () => undefined,
    ...overrides,
  } as RouteContextLike
}

/** A root module whose component renders whatever `render` returns. */
function root(overrides: Partial<RootModule> = {}): RootModule {
  return { default: { render: () => h('div') }, ...overrides }
}

describe('createBunvueApp', () => {
  it('calls configure() with the app, the router and the head', async () => {
    let seen: { app: App; router: Router; head: unknown } | undefined
    const head = createHead()
    const { instance, router } = await createBunvueApp({
      root: root({
        configure: (ctx) => {
          seen = ctx
        },
      }),
      routes: records(),
      routeMap,
      ctxHydration: context(),
      head,
    })
    expect(seen?.app).toBe(instance)
    expect(seen?.router).toBe(router)
    expect(seen?.head).toBe(head)
  })

  it('swallows response signals and keeps the app error handler for the rest', async () => {
    const seen: unknown[] = []
    const ctxHydration = context()
    const { instance } = await createBunvueApp({
      root: root({
        configure: ({ app }) => {
          app.config.errorHandler = (error: unknown): void => {
            seen.push(error)
          }
        },
      }),
      routes: records(),
      routeMap,
      ctxHydration,
      head: createHead(),
    })

    const signal = new ResponseSignal(new Response(null, { status: 302 }))
    instance.config.errorHandler?.(signal, null, '')
    expect(ctxHydration.error).toBeUndefined()
    expect(seen).toEqual([])

    const boom = new Error('boom')
    instance.config.errorHandler?.(boom, null, '')
    expect(ctxHydration.error).toBe(boom)
    expect(seen).toEqual([boom])
  })

  it('provides the serialized route table and the layout ref', async () => {
    const ctxHydration = context({ layout: 'admin' })
    let table: unknown
    let layout: Ref<string> | undefined
    const { instance, router } = await createBunvueApp({
      root: root({
        default: {
          setup() {
            table = inject(serializedRoutes)
            layout = inject(routeLayout) as Ref<string>
            return () => h('div')
          },
        },
      }),
      routes: records(),
      routeMap,
      ctxHydration,
      head: createHead(),
    })
    await router.push('/')
    await router.isReady()
    await renderToString(instance)

    expect(table).toHaveLength(2)
    expect((table as SerializedRoute[])[0].name).toBe('index')
    // The layout ref starts on the context's layout, so the page's own layout
    // is the one rendered on the first server render.
    expect(layout?.value).toBe('admin')
  })

  it('falls back to the default layout when the context names none', async () => {
    let layout: Ref<string> | undefined
    const { instance, router } = await createBunvueApp({
      root: root({
        default: {
          setup() {
            layout = inject(routeLayout) as Ref<string>
            return () => h('div')
          },
        },
      }),
      routes: records(),
      routeMap,
      ctxHydration: context(),
      head: createHead(),
    })
    await router.push('/')
    await router.isReady()
    await renderToString(instance)

    expect(layout?.value).toBe('default')
  })
})

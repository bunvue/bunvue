<script>
import { h, inject, Suspense, unref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { routeLayout } from 'bunvue/client'

// Used when the app ships no `layouts/default.vue`.
const DefaultLayout = {
  setup(_, { slots }) {
    return () => h('div', { class: 'layout' }, slots.default?.())
  },
}

// The glob has to live in a module Vite transforms inside the app root, which
// is exactly what a `$app/*` virtual module is.
const appLayouts = import.meta.glob('/layouts/*.vue', { eager: true })
const layouts = Object.fromEntries(
  Object.keys(appLayouts).map((path) => [path.slice(9, -4), appLayouts[path].default]),
)
layouts.default ??= DefaultLayout

const Layout = {
  setup(_, { slots }) {
    const layoutRef = inject(routeLayout)
    return () => {
      const name = unref(layoutRef) ?? 'default'
      const LayoutComponent = layouts[name] ?? layouts.default
      const children = () => slots.default?.()
      return LayoutComponent ? h(LayoutComponent, null, { default: children }) : children()
    }
  },
}

export default {
  setup() {
    const route = useRoute()
    const isServer = import.meta.env.SSR

    return () =>
      h(RouterView, null, {
        default: (slotProps) => {
          const Component = slotProps?.Component
          const child = Component ? h(Component, { key: route.path }) : null
          const wrapped = h(Layout, null, { default: () => child })
          return isServer ? wrapped : h(Suspense, null, { default: () => wrapped })
        },
      })
  },
}
</script>

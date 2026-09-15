/// <reference types="vite/client" />

/**
 * Ambient types for the `$app/*` virtual module namespace owned by bunvue:
 * the two entries (`mount.ts`, `index.ts`), the two globs (`routes.ts`,
 * `actions.ts`), `router.vue` and the two conventions (`context.ts`, `root`).
 * Add `"types": ["bunvue/virtual"]` (or list this file in `include`) in an
 * app's tsconfig to type the convention files.
 */

/** The public surface of `bunvue/virtual` itself. */
declare module 'bunvue/virtual' {
  export type PageModule = import('bunvue/client').PageModule
  export type I18nConfig = import('bunvue/client').I18nConfig
  export type RouteContextLike<
    S = unknown,
    State = import('bunvue/client').DefaultState,
  > = import('bunvue/client').RouteContextLike<S, State>
  export type RouteContextExtras = import('bunvue/client').RouteContextExtras
  export type RouteContextWithExtras<
    S = unknown,
    State = import('bunvue/client').DefaultState,
  > = import('bunvue/client').RouteContextWithExtras<S, State>
}

declare module '$app/routes.ts' {
  const routes: Record<string, () => Promise<import('bunvue/client').PageModule>>
  export default routes
}

declare module '$app/actions.ts' {
  const actions: Record<string, () => Promise<{ action?: unknown }>>
  export default actions
}

declare module '$app/context.ts' {
  export const state: (() => Record<string, unknown>) | undefined
  const setup: (ctx: import('bunvue/client').RouteContextLike) => void | Promise<void>
  export default setup
}

declare module '$app/root' {
  const component: import('vue').Component
  export default component
  export const mount: string | undefined
  export const scrollBehavior: import('vue-router').RouterScrollBehavior | undefined
  export const configure:
    | ((ctx: {
        app: import('vue').App
        router: import('vue-router').Router
        head: unknown
      }) => void | Promise<void>)
    | undefined
}

declare module '$app/router.vue' {
  const component: import('vue').Component
  export default component
}

declare module '/$app/router.vue' {
  const component: import('vue').Component
  export default component
}

declare module '*.vue' {
  const component: import('vue').Component
  export default component
}

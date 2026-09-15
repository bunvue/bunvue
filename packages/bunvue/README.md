# bunvue

Vue 3 SSR on `Bun.serve`, with Vite for dev, HMR and bundling.

Vite runs in process during development, and a dual client plus SSR build produces a plain `dist/` for
production.

- Vue 3.5, vue-router 4, `@unhead/vue` 3.4 or newer
- Bun 1.4, Vite 8, TypeScript sources run directly by Bun
- Routing is done by Bun's native router. bunvue only picks between locale hosts
  and runs the middleware chain, both composed once when the route table is built.

## Install

```sh
bun add bunvue vue vue-router @unhead/vue
bun add -d vite @vitejs/plugin-vue
```

`vue`, `vue-router`, `@unhead/vue` and `vite` are peer dependencies, so the app and
bunvue always share one copy of each.

To start from a working app instead, copy one of the
[examples](../../README.md#examples) with giget, for instance
[basic](../../examples/basic/README.md).

## Request pipeline

Every request goes through Bun's native path matching first. In order of the route
table:

1. **App page routes.** One entry per distinct path pattern. Several locale routes
   that share a path collapse into a single handler that picks the candidate by
   `url.hostname`, host constrained first, then unconstrained, else 404. Each
   pattern registers GET, HEAD, POST, PUT, PATCH and DELETE, since Bun hands a
   method missing from a route to `fetch`, and bunvue answers a method the page
   does not accept with its own 405.
2. **Asset and Vite routes.** In production, `/{assetsDir}/*` is served from
   `dist/client/assets` with immutable cache headers. In development, `/@vite/*`,
   `/@fs/*`, `/@id/*`, `/node_modules/*`, `/$app/*`, `/__vite_ping` and
   `/__open-in-editor` are proxied to the in process Vite server.
3. **User routes**, from the `routes` option. These are declared last, so a user
   route wins over a colliding app path.
4. **The `fetch` fallback**, for anything Bun did not match. In development it
   proxies to Vite, in production it serves public files from `dist/client` and
   otherwise answers `onNotFound` or a plain 404.

Prefix wildcards such as `/api/*` outrank an app catch all page (`/*`) in Bun's
precedence, so a proxied route never reaches the renderer. Inside a catch all
handler bunvue still checks, before rendering, whether the path is a Vite module,
an asset or a public file.

Rendering a page: create the request context (`state()`, then the default export of
`context.ts`), run the page action for anything but GET and HEAD (see
[Page actions](#page-actions)), create the Vue app, push the URL into the router,
render with `renderToString` or `renderToWebStream`, push `ctx.head` into unhead,
build the hydration script, run `transformHtmlTemplate` over the shell and answer
with `ctx.status` and `ctx.headers`. `ctx.response` is checked after context
creation, after the action, after `router.isReady()` and after the render
resolves, so a redirect or a 404 raised anywhere in that window wins over the
rendered markup.

## App conventions

An app is a Vite root (`client/` by convention) plus a server entry.

```
myapp/
  server.ts
  vite.config.ts
  client/
    index.html
    context.ts        optional
    root.vue          optional
    pages/**/*.vue
    pages/**/*.server.ts  optional, page actions
    layouts/*.vue     optional
```

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <div id="root"><!-- element --></div>
    <!-- hydration -->
    <script type="module" src="/$app/mount.ts"></script>
  </body>
</html>
```

`<!-- element -->` is where the rendered markup goes and `<!-- hydration -->` is
where the hydration JSON block goes. Both placeholders are required. The mount
script is stripped for `serverOnly` pages, which also get no hydration block.

`src="/$app/mount.js"` works as well as `.ts`: a `$app/*` request resolves to the
extension of the file bunvue actually loads.

### `pages/`

File names map to paths: `pages/index.vue` becomes `/`, `pages/dynamic/[id].vue`
becomes `/dynamic/:id`, `pages/[slug+].vue` becomes a catch all whose joined path
segments arrive as `ctx.params.slug`.

A page may export, beside its default component:

| Export       | Meaning                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| `layout`     | Name of a file in `layouts/`, without the extension                         |
| `clientOnly` | Skip SSR. The shell ships without markup and the page mounts in the browser |
| `serverOnly` | No hydration payload and no mount script                                    |
| `streaming`  | Render with `renderToWebStream` instead of buffering                        |
| `path`       | Overrides the path derived from the file name                               |
| `i18n`       | `Record<locale, string>` of localized paths                                 |

```vue
<template>
  <p>Rendered on the server only.</p>
</template>

<script lang="ts">
export const serverOnly = true
</script>
```

Data loading is a top level `await` in `<script setup>`. Handling a form submission is done in a sibling file, see [Page actions](#page-actions).

### `context.ts`

```ts
import type { RouteContextLike } from 'bunvue/client'

export interface AppState {
  todoList: string[]
}

export function state(): AppState {
  return { todoList: [] }
}

export const actions = {
  greet: (name: string) => `Hello, ${name}!`,
}

export default async function context(ctx: RouteContextLike<AppServer, AppState>) {
  ctx.state.todoList = ctx.server.db.todoList
}
```

`state()` seeds the per request state that is serialized into the hydration block
and made reactive on the client. The default export runs before rendering. Any other
named export (`actions` above) is copied onto the context on both sides.

#### How state is serialized

The hydration payload is not executable JavaScript. It ships as the text content
of a single element right where `<!-- hydration -->` sits:

```html
<script type="application/json" id="__bunvue__" data-format="json">
  {"route":{...},"routes":[...],"runtimeConfig":{...}}
</script>
```

The block is serialized JSON first: when everything in the payload survives a
`JSON.stringify` / `JSON.parse` round trip, `data-format` is `json` and the
browser parses it natively, which is faster than parsing JavaScript source.
Anything JSON cannot represent, a `Date`, `Map`, `Set`, `RegExp`, typed array,
class instance, `bigint`, `NaN`, `Infinity`, `-0`, an `undefined` property value,
or a cycle, drops the whole block to `data-format="devalue"`, where both fields
hold devalue's reduced form (a flat array of nodes with back references, so
shared and cyclic references survive as the same object). In development the
offending key path is logged once per route.

`data-format` covers `route` and `routes` only. `runtimeConfig` is validated as
pure JSON once at startup, so it is always written as plain JSON and read back
without devalue.

devalue's revival code is imported lazily, only when `data-format` says
`devalue`, so a JSON page never downloads it.

Because the block is data rather than code, a string value containing
`</script>` cannot break out: every `<` is written as the JSON escape `\u003C`,
along with U+2028 and U+2029.

Each top level key of `ctx.state` is serialized on its own and memoized by object
identity, so a translation table or a menu that comes from a TTL cache and is
assigned by reference is serialized once and its text is reused on every later
request. **Objects placed on `ctx.state` and shared across requests are treated as
immutable after their first serialization.** Mutating one later keeps serving the
text captured the first time. Build a new object instead, which also gives the
memo a new key.

#### Running inline code that needs the payload

Wait for the `bunvue:hydrated` event, which the mount script dispatches on `document` right
after it has set `window.route` and `window.routes` and before the app is
created:

```html
<script>
  document.addEventListener('bunvue:hydrated', () => {
    const config = window.route.runtimeConfig
    // ... bootstrap analytics, feature flags, anything that needs the payload
  })
</script>
```

The event carries no detail, Vue components should use
`useAppContext()` instead, which works on both sides.

### Runtime config

Config the app passes once at startup, shipped in the hydration block and read
the same way on both sides:

```ts
createBunvue({
  root: import.meta.dirname,
  runtimeConfig: {
    siteName: 'bunvue basic',
    features: { newsletter: true },
  },
})
```

```vue
<script setup lang="ts">
import { useRuntimeConfig } from 'bunvue/client'

const config = useRuntimeConfig()
</script>

<template>
  <p>{{ config.siteName }}</p>
</template>
```

**It is public by definition.** Everything in it is written into the page and
readable by anyone. Keep secrets on `ctx.server`, which never leaves the server.

It has to be plain JSON. It is validated and serialized once, at startup, not per
request: a `Date`, a function, an `undefined` value or a cycle throws before the
server listens, naming the key (`bunvue: runtimeConfig.gtm is not JSON
serializable`). Omitted, it is `{}`.

`RuntimeConfig` is an empty interface, so an app declares its own shape by
merging into it, in any `.d.ts` the app's tsconfig includes:

```ts
import 'bunvue/client'

declare module 'bunvue/client' {
  interface RuntimeConfig {
    siteName: string
    features: { newsletter: boolean }
  }
}
```

The `runtimeConfig` option, `useRuntimeConfig()` and `ctx.runtimeConfig` are then
all typed from that one declaration. `useRuntimeConfig<T>()` takes an explicit
type instead, for an app that would rather not merge.

An inline `<script>` in `index.html` reads the same object as
`window.route.runtimeConfig`, once the `bunvue:hydrated` event has fired.

### Page actions

A page handles POST, PUT, PATCH and DELETE through a sibling file named after it:
`pages/form.vue` pairs with `pages/form.server.ts` (or `.server.js`).

```ts
// pages/form.server.ts
import type { PageAction } from 'bunvue'
import type { AppServer } from '../../server.ts'
import type { AppState } from '../context.ts'

export const action: PageAction<AppServer, AppState> = async (ctx) => {
  const form = await ctx.formData()
  const email = String(form.get('email') ?? '')
  if (!email.includes('@')) {
    ctx.status = 422
    return { errors: { email: 'Invalid address' }, values: { email } }
  }
  return ctx.redirect('/form?sent=1')
}
```

```vue
<!-- pages/form.vue -->
<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const result = (ctx.actionData ?? {}) as { errors?: { email?: string } }
</script>
```

Only the SSR entry imports these files, through the glob in `$app/actions.ts`, so
neither the action nor anything it imports reaches the client bundle. The SFC is
not transformed: the page stays a plain component and data loading stays in
`<script setup>`. All locale routes of a page share its action. A `.server.ts`
file without a matching page is ignored with a warning.

A request that is not GET or HEAD goes through these steps:

1. A page without an action answers `405` with `Allow: GET, HEAD`. A page with
   one accepts GET, HEAD, POST, PUT, PATCH and DELETE.
2. The origin check below runs, before the body is read and before `context.ts`.
3. The context is created as for any page, `state()` then the default export of
   `context.ts`, so the session and the state are there for the action. A
   `ctx.response` set at this point wins.
4. The action runs. Returning a `Response`, returning or throwing the signal of
   `ctx.redirect()` or `ctx.notFound()`, or merely calling one of them answers
   the request right there, with `ctx.headers` merged in. Anything else it
   returns becomes `ctx.actionData`.
5. The page renders as for a GET, with the `ctx.status` and `ctx.headers` the
   action set.

A GET or HEAD never runs the action. All of this happens before the Vue app is
created, so a `streaming` page with an action still answers a real 303 rather than
the `location.replace()` fallback. An error thrown by the action reaches `onError`
like any render error, and with timing on the action gets its own `action` entry
in `Server-Timing`.

A login action can therefore set its session cookie with
`ctx.headers.append('set-cookie', ...)` and then `return ctx.redirect('/')`. The
same merge applies to a page that calls `ctx.redirect()` or `ctx.notFound()`
while rendering. Headers already on the answering response win, except
`set-cookie`, which is appended. A streaming page has committed its headers by
then, so its `location.replace()` fallback carries none of this.

`ctx.formData()` and `ctx.json()` read the body once and hand back the same
promise on every call. Asking for the other kind afterwards throws an error naming
the one already used. Both exist on the server only. `ctx.redirect()` defaults to
303 for a request that is not GET or HEAD, so the browser follows it with a GET,
and to 302 otherwise. An explicit status still wins.

`ctx.actionData` goes into the hydration block next to the state, and only when
the action returned something, so the client hydrates the markup the server
rendered. Keep it to plain data: as with the state, a value JSON cannot represent
(a `Date`, an `undefined` property) moves the whole block to the devalue format.
The client drops it on the first client side navigation.

Page actions answer with documents: a form that works without JavaScript and a
response that is a page. JSON endpoints for client side mutations still belong in
the `routes` option or behind `proxy()`.

#### Origin check

A browser sends `Origin` with every cross origin POST. A request reaching an
action is refused with `403` when the host of its `Origin` differs from the
request's host (`url.host`) and the origin is not a trusted one. The scheme is
ignored, so a TLS terminating proxy, where Bun sees `http://` while the browser
sends `https://`, works as is. An `Origin` that does not parse, the literal
`null` included, is refused. Without `Origin`, `Sec-Fetch-Site: cross-site` is
refused as well. A request carrying neither header comes from a non browser
client and is allowed. Behind a proxy that rewrites the `Host` header, or for a
form posted from another site of yours, list the extra origins in full:

```ts
createBunvue({ root, csrf: { trustedOrigins: ['https://www.example.com'] } })
```

`csrf: false` turns the check off.

#### Client import guard

In the client environment the bunvue Vite plugin refuses to resolve or load any
`*.server.ts` or `*.server.js` file under `pages/`. Importing one from a component
fails with `[bunvue] pages/form.server.ts is server only and cannot be imported
from client code`, and a dev request for the file gets an error instead of its
source. The SSR environment and the module runner are unaffected.

### `root.vue`

```vue
<script lang="ts">
import router from '$app/router.vue'

export const mount = '#root'

export default router
</script>
```

Optional. It may also export `configure({ app, router, head })`, awaited before the
first render, and `scrollBehavior` for the client router. An app is free to set
`app.config.errorHandler` in `configure()`: bunvue installs its own handler around
it afterwards, so `ctx.redirect()` and `ctx.notFound()` thrown from a page are
still captured while every real error is passed on to the app's handler.

Writing the default export as an `import` plus `export default` rather than
`export { default } from` keeps `vue-tsc` happy.

`$app/router.vue` is the only `$app` module an app imports. It is the `RouterView`
plus its `Suspense` wrapper, and it resolves the layout as well.

### `layouts/`

Optional. Every `layouts/*.vue` file is a layout, named after the file without the
extension, and a page picks one with its `layout` export. Without a `layout` the
page gets `layouts/default.vue`, and without that file bunvue's own placeholder,
a `<div class="layout">` around the page.

## Locale routing

Locale routing is the `i18n` option of `createBunvue`:

```ts
const app = await createBunvue({
  root: import.meta.dirname,
  i18n: {
    locales: ['en', 'fi'],
    localePrefix: true,
    // or: localeDomains: { en: 'example.com', fi: 'example.fi' }
  },
}).ready()
```

With a prefix, each page expands to one route per locale, `/{locale}{path}`, and the
default locale keeps `/` for the index. With locale domains, each route carries a
host constraint and is selected at request time by `url.hostname`. A page's `i18n`
export overrides the path for a given locale.

The option is read at process start rather than at build time, so the domains can
come from the environment and one build can serve every environment:

```ts
i18n: {
  locales: ['se', 'fi'],
  localeDomains: { se: process.env.SE_HOST!, fi: process.env.FI_HOST! },
}
```

None of it is bundled or sent to the browser, and nothing needs to be: the route
table already carries the locale of every route, which is what
[`useLocaleRoutes()`](#uselocaleroutes) builds its links from.

## `useRouteContext()`

```ts
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
```

The same accessor works on both sides. On the server it is the live `RouteContext`,
on the client it is the hydrated payload object with reactive `state`, plus
`url`, `params` and `meta` refreshed by the router on every navigation. `request`,
`server`, `headers`, `formData()` and `json()` exist on the server only and are
typed optional.

### Typing the context

`RouteContextLike<S, State>` types `ctx.server` and `ctx.state`, so an app declares
its own context once and passes it to the accessor:

```ts
import { useRouteContext, type RouteContextLike } from 'bunvue/client'
import type { AppState } from '../context.ts'
import type { AppServer } from '../../server.ts'

export interface AppCtx extends RouteContextLike<AppServer, AppState> {}

const ctx = useRouteContext<AppCtx>()
ctx.state.todoList.push('Write report') // string[], not unknown
```

`State` defaults to `Record<string, unknown> | null`, which is what `state` holds
when the app has no `context.ts`. The interface carries no catch-all index
signature, so an app can narrow it and `Omit<AppCtx, 'server'>` keeps its
properties typed. The named exports `context.ts` attaches are typed separately as
`RouteContextExtras`: `useRouteContext()` without a type argument returns
`RouteContextWithExtras`, where `ctx.actions` and friends are `unknown` and are
cast at the use site.

`ctx.redirect(to, status?)` and `ctx.notFound()` **do not throw**. They set
`ctx.response` and return a `ResponseSignal`, so a component can call them halfway
through `<script setup>` and keep running, exactly like the Fastify version did.
The redirect status defaults to 302, or 303 when the request is a POST, PUT,
PATCH or DELETE.
Throwing the returned signal is allowed when you want to abort the render right
there: the server side Vue error handler swallows `ResponseSignal` and rethrows
everything else. On the client both are implemented as `router.push` wrappers, so
a composable calling them works isomorphically.

## `useHydrationData()`

Fetch on the server, ship the result in the hydration payload, reuse it on the
client while hydrating:

```vue
<script setup lang="ts">
import { useHydrationData, useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const slug = ctx.params.slug

const product = await useHydrationData(`product:${slug}`, () => db.product(slug))
</script>
```

```ts
function useHydrationData<T>(key: string, fetcher: () => T | Promise<T>): Promise<T>
```

On the server the fetcher runs and the awaited result is stored on `ctx.data`,
which travels in the hydration payload. On the client's first render the key is
already there, so the fetcher is skipped and the markup matches what the server
sent. After a client side navigation the payload is gone and the fetcher runs in
the browser, per navigation, writing nothing back.

**The key is yours to get right.** It has to carry everything the result varies
by, which is why the example above interpolates the slug: `'product'` alone would
hand the next product the previous one's data. Two components asking for the same
key during one server render share a single fetch.

The value comes back as it is, not a ref and not made reactive, and it goes
through the normal payload serialization, so a `Date` in it drops the whole block
onto the devalue path. A fetcher that throws propagates and stores nothing, so a
page can still call `ctx.notFound()` from a catch.

`ctx.data` is bunvue's, so a `context.ts` named export called `data` would collide
with it.

## `useLocaleRoutes()`

Locale aware links, derived from the serialized route table alone, so an app never
hardcodes bunvue's route names or its prefix rules:

```ts
import { useLocaleRoutes } from 'bunvue/client'

const { locale, locales, localePath, localeHref, switchLocalePath } = useLocaleRoutes()
```

```ts
type LocaleTarget =
  | string
  | { name: string; params?: Record<string, string>; query?: LocationQueryRaw; hash?: string }

interface LocaleRoutes {
  locale: string
  locales: string[]
  localePath(to: LocaleTarget, locale?: string): RouteLocationRaw
  localeHref(to: LocaleTarget, locale?: string): string
  switchLocalePath(locale: string, params?: Record<string, string>): string
}
```

`locales` are the locales of the route table in order, the default one first, and
`locale` is the one of the current route. It is a getter on the returned object, so
destructure it per page and keep the functions for the rest.

A target is a base route name (`'about'`, the name before bunvue's `${locale}__`
prefix), an unlocalised path (`'/about'`, `'/product/x'`), or a named location with
params, query and hash. An already localised name or path works too, which is what
lets a page pass its own `route.name` straight through. `localePath()` returns a
vue-router location for `RouterLink :to` on the same host, `localeHref()` returns an
href, absolute when the locale lives on another host:

```vue
<template>
  <RouterLink :to="localePath('about')">About</RouterLink>
  <RouterLink :to="localePath({ name: 'product', params: { slug } }, 'fi')">Tuote</RouterLink>
</template>
```

`switchLocalePath()` is the language switcher: the current page in another locale,
keeping the current params, query and hash. With locale domains the href crosses to
the other host, reusing the scheme and port of the current request, so one port
serves every locale host in dev and in tests:

```vue
<template>
  <nav>
    <a v-for="l in locales" :key="l" :href="switchLocalePath(l)">{{ l }}</a>
  </nav>
</template>

<script setup lang="ts">
import { useLocaleRoutes } from 'bunvue/client'

const { locales, switchLocalePath } = useLocaleRoutes()
</script>
```

**Switching keeps the params.** A page's `i18n` export translates the path pattern,
never the values in it, so `/fi/tuote/hammer` is what `/en/product/hammer` switches
to. Translated slugs are the app's own, and the second argument takes them:

```ts
switchLocalePath('fi', { slug: product.slugs.fi })
```

A target nothing matches is returned unchanged rather than thrown, so a stale link
cannot crash a render, with a `console.warn` once per target in dev.

Call it inside a component's setup, like the other composables.

## Server API

```ts
import { createBunvue, proxy } from 'bunvue'

const app = await createBunvue({
  root: import.meta.dirname,
  dev: process.argv.includes('--dev'),
  server: { db },
  runtimeConfig: { siteName: 'bunvue basic' },
  i18n: { locales: ['en', 'fi'], localePrefix: true },
  routes: [
    { path: '/healthz', handler: () => Response.json({ status: 'ok' }) },
    proxy('/api', process.env.API_URL!),
  ],
  middleware: [
    async (request, next) => {
      const response = await next()
      response.headers.set('x-powered-by', 'bunvue')
      return response
    },
  ],
  static: { maxAge: 31536000, immutable: true },
  vite: { port: 5173 },
  onNotFound: ({ url }) => new Response(`No page at ${url.pathname}`, { status: 404 }),
  onError: (error) => new Response('Boom', { status: 500 }),
}).ready()

app.serve({ port: 3000 })
```

| Option          | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `root`          | The app package root, usually `import.meta.dirname`                            |
| `dev`           | Defaults to `process.argv.includes('--dev')`                                   |
| `server`        | Anything you want on `ctx.server`, typed through `createBunvue<S>`             |
| `runtimeConfig` | Public, JSON only config for both sides, read with `useRuntimeConfig()`        |
| `i18n`          | `locales`, `localePrefix` and `localeDomains` for locale routing               |
| `routes`        | `UserRoute[]`, matched by Bun before the app's own pages                       |
| `middleware`    | `(request, next, server) => Response`, wrapped around every route              |
| `vite`          | Dev only: `port`, `host`, extra `config` merged into the inline config         |
| `static`        | Production asset cache headers, default one year and immutable                 |
| `onNotFound`    | Builds the 404 response, also used by `ctx.notFound()`                         |
| `onError`       | Replaces the built in error page                                               |
| `csrf`          | Origin check for page actions, on by default. `false`, or `{ trustedOrigins }` |

`ready()` resolves once Vite (dev) or `dist/` (prod) is loaded and the route table
is built. The returned app exposes:

- `routes`: the Bun route table, ready to spread into `Bun.serve({ routes })`
- `fetch(request)`: the fallback handler
- `serve(options)`: `Bun.serve({ routes, fetch, ...options })`, keeping the handle
  so bunvue can call `server.reload()` when a page is added or removed in dev
- `close()`, `appRoutes`, `server`, `vite`, `onRoutesChanged(cb)`

Calling `Bun.serve` yourself works too, but then hot route table changes in dev are
yours to apply through `onRoutesChanged`.

### `proxy(prefix, upstream, options?)`

A reverse proxy route helper:

```ts
proxy('/api', process.env.API_URL!, { rewritePrefix: '/api' })
```

- Method, query string and body are preserved. POST, PUT, PATCH and DELETE bodies
  are streamed upstream, never buffered.
- `rewritePrefix` replaces `prefix` in the upstream path. It defaults to `prefix`,
  which keeps the path unchanged.
- The incoming `Host` header is dropped, because `fetch` derives the upstream host
  from the target URL. `x-forwarded-host` and `x-forwarded-proto` are filled in when
  absent, and the client address from `server.requestIP()` is appended to
  `x-forwarded-for` when Bun can report it.
- Hop by hop headers are dropped in both directions, along with `content-encoding`
  and `content-length` on the way back, since `fetch` has already decoded the body.
  Everything else passes through untouched, so a custom `x-records` response header
  and repeated `set-cookie` headers survive.
- 204, 205, 304 and 101 responses are relayed without a body. Redirects are relayed
  as they are (`redirect: 'manual'`).
- `options.headers(headers, request)` adjusts the forwarded request headers and
  `options.responseHeaders(headers)` adjusts the response headers.

`proxyRequest(request, origin, options?)` is the underlying one shot helper.

## Development and production

```sh
bun server.ts --dev          # Vite in process, HMR, SSR through the module runner
bun --bun vite build --app   # client and SSR build
bun server.ts                # production
```

In dev, Bun owns the public port and Vite listens on an internal one. The browser's
HMR websocket connects straight to Vite's port through `server.ws.clientPort`, so
`Bun.serve` never handles the upgrade. The SSR entry is re-imported through Vite's
module runner on every request, which is how an edited page shows up without a
restart. Adding or deleting a page or a page action rebuilds the Bun route table
and calls `server.reload()`.

Build output:

```
dist/
  vite.config.json          resolved base, root, assetsDir, outDirs
  client/
    index.html
    .vite/manifest.json
    assets/                 hashed JS, CSS and images
    html/**/*.html          per page shells with modulepreload and CSS links
    (public files)
  server/
    index.js                the SSR entry
    assets/
```

## Known limitations

- **Streaming and the head.** A `streaming` page commits its status, headers and
  `<head>` with the first chunk. Head tags pushed after an await arrive later as
  patch scripts appended by unhead's stream wrapper, and a redirect raised mid render
  can only be honoured by a `<script>location.replace(...)</script>` in the tail.
  Use a buffered page when the head or the status depends on data. A page action
  runs before the render, so its redirect is always a real one.
- **Page SFCs and the default export.** Rollup rejects a `<script>` block that only
  has named exports with `MISSING_EXPORT`. bunvue's `bunvue:pages` plugin injects an
  `export default {}` into such a block for files under `pages/`, so pages that only
  export `serverOnly` or `layout` build as expected. Pages with `<script setup>` are
  untouched, since that always compiles to a default export.
- **HMR websocket.** The browser connects directly to Vite's port, which must be
  reachable from the browser. Behind a remote dev host, set `vite.host` and
  `vite.port` explicitly.
- **Serialization.** State that neither JSON nor `devalue.stringify` can serialize
  (a function, for instance) throws at render time. Keep `state()` to plain data,
  which also keeps it on the fast JSON path.
- **Shared state is frozen by the memo.** An object on `ctx.state` that is reused
  across requests is serialized once, so later mutations of it are not reflected in
  the hydration payload.

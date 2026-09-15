# Changelog

All notable changes to bunvue are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release section
becomes the notes of its GitHub release.

## [Unreleased]

First public release of bunvue, a port of `@fastify/vite` and `@fastify/vue` to
`Bun.serve` with a web standard `Request` and `Response` API.

### Added

- Vue 3 SSR served by `Bun.serve`, with Vite for dev, HMR and the client and SSR
  builds.
- Page routes from `pages/**/*.vue`, matched by Bun's native routes table, with
  `layout`, `clientOnly`, `serverOnly`, `streaming`, `path` and `i18n` page exports.
- `context.ts` with `state()`, a default export that runs before rendering, and
  named exports copied onto the context.
- `useRouteContext()` on the server and the client, with `ctx.redirect()` and
  `ctx.notFound()` that set the response without throwing.
- Hydration payload as a JSON block, falling back to devalue for values JSON cannot
  represent.
- Locale prefix and locale domain routing, configured with the `i18n` option of
  `createBunvue` so locale domains can be read from the environment at startup.
- Page actions in sibling `pages/*.server.ts` files for POST, PUT, PATCH and
  DELETE, with `ctx.formData()`, `ctx.json()` and `ctx.actionData`. Pages without
  an action answer 405, and actions get an origin check (the `csrf` option).
- A guard that stops client code from importing `*.server.ts` files.
- `createBunvue` options for user `routes`, `middleware`, `onNotFound`, `onError`
  and static asset caching.
- `runtimeConfig`, a public JSON only config passed once to `createBunvue`,
  validated at startup, shipped as its own field of the hydration block and read
  with `useRuntimeConfig()` or `ctx.runtimeConfig` on both sides. Apps type it by
  merging into the `RuntimeConfig` interface.
- `useHydrationData(key, fetcher)`, which fetches on the server, ships the result
  in the hydration payload as `ctx.data`, reuses it on the client while hydrating
  and fetches again after a client side navigation.
- `useLocaleRoutes()`, locale aware links built from the serialized route table on
  both sides: `localePath()`, `localeHref()` and `switchLocalePath()`, plus the
  current `locale` and the table's `locales`. Links cross to another locale domain
  as absolute URLs, and no i18n config is sent to the browser.
- `proxy()`, a reverse proxy route helper.
- A standalone `basic` example with ESLint and Prettier set up, copied with giget,
  plus demos for locale prefix routing, locale domain routing and reverse proxying.

[Unreleased]: https://github.com/bunvue/bunvue/commits/main

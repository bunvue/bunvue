# bunvue i18n prefix example

Locale prefix routing. Every page expands to one route per locale, `/en/about`
and `/fi/about`, and a page's `i18n` export gives it a localized path. The
locales are the static `i18n` option of `createBunvue` in `server.ts`.

Run it from a checkout of the bunvue repository. Use the
[basic](../basic/README.md) example as a starter for a new app.

```sh
bun run --cwd examples/i18n-prefix dev         # bun server.ts --dev, Vite in process with HMR
bun run --cwd examples/i18n-prefix build       # client and SSR build into dist/
bun run --cwd examples/i18n-prefix start       # production server on port 3001, or $PORT
bun run --cwd examples/i18n-prefix typecheck   # vue-tsc over the app
```

Requires Bun 1.4 or newer.

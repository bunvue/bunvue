# bunvue i18n domains example

Locale domain routing. Each locale is served from its own host, `se.test` and
`fi.test`, and the route is picked by the request's hostname. Point both names at
`127.0.0.1` in `/etc/hosts` to try it locally.

The point of this example is where the hosts come from: the `i18n` option of
`createBunvue` in `server.ts` reads them from `SE_HOST` and `FI_HOST` at process
start, falling back to the `.test` names. Nothing about the domains is baked
into the build, so one build serves staging and production.

```sh
SE_HOST=se.example.com FI_HOST=fi.example.com bun run --cwd examples/i18n-domains start
```

Run it from a checkout of the bunvue repository. Use the
[basic](../basic/README.md) example as a starter for a new app.

```sh
bun run --cwd examples/i18n-domains dev         # bun server.ts --dev, Vite in process with HMR
bun run --cwd examples/i18n-domains build       # client and SSR build into dist/
bun run --cwd examples/i18n-domains start       # production server on port 3001, or $PORT
bun run --cwd examples/i18n-domains typecheck   # vue-tsc over the app
```

Requires Bun 1.4 or newer.

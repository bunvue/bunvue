# bunvue proxy example

A catch all page plus reverse proxy routes. `/api/*` is forwarded to `API_URL` and
still outranks the `[slug+]` page, `/rewrite/*` maps to `/v1/*` upstream, and
`/tagged/*` adjusts the request and response headers on the way through.

Run it from a checkout of the bunvue repository. Use the
[basic](../basic/README.md) example as a starter for a new app.

```sh
API_URL=http://localhost:4000 bun run --cwd examples/proxy dev   # bun server.ts --dev
bun run --cwd examples/proxy build                               # client and SSR build into dist/
API_URL=http://localhost:4000 bun run --cwd examples/proxy start # production server on port 3003
bun run --cwd examples/proxy typecheck                           # vue-tsc over the app
```

Requires Bun 1.4 or newer.

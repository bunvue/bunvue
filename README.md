# bunvue

Monorepo for **bunvue**, a Vue 3 SSR framework that serves with `Bun.serve` and uses
Vite for dev, HMR and bundling. It is a port of the `@fastify/vite` plus
`@fastify/vue` approach to a Bun native, web standard only API.

Start here: [packages/bunvue/README.md](packages/bunvue/README.md).

## Examples

`examples/basic` is a standalone starter with ESLint and Prettier set up. Copy it
with giget:

```sh
bunx giget@latest gh:zanmato/bunvue/examples/basic my-app --install
```

The other examples are demos of one feature each and run from a checkout of this
repository, for instance `bun run --cwd examples/proxy dev`.

- [basic](examples/basic/README.md), a minimal app that doubles as the test fixture
- [i18n-prefix](examples/i18n-prefix/README.md), locale prefix routing
- [i18n-domains](examples/i18n-domains/README.md), locale domain routing
- [proxy](examples/proxy/README.md), a catch all page plus reverse proxy routes

## Benchmarks

One 600 node Vue tree rendered per request, single process each, 64 connections for
20 seconds on loopback. Bun 1.4.2 with `Bun.serve` against Node 25.9 with Fastify 5,
same `vue` 3.5.42 and component tree on both sides.

| variant          | runtime        | req/s | p99 ms | RSS MB |
| ---------------- | -------------- | ----: | -----: | -----: |
| static HTML      | Bun            | 44856 |   2.57 |   49.7 |
| static HTML      | Node + Fastify | 28091 |   3.14 |  143.3 |
| Vue SSR          | Bun            |  2502 |  46.06 |   80.3 |
| Vue SSR          | Node + Fastify |  2278 |  52.57 |  298.0 |
| Vue SSR + unhead | Bun            |  2219 |  35.63 |   84.9 |
| Vue SSR + unhead | Node + Fastify |  2080 |  55.58 |  344.4 |

- The HTTP stack alone is about 1.6x faster on Bun.
- Once `renderToString` is in the path the render dominates, and Bun is about 10
  percent ahead with a lower p99.
- Memory is the real difference. Bun holds 80 to 100 MB where Node holds 300 to
  345 MB for identical output.

Note that it is a micro benchmark. Run it yourself with `bun run bench`,
and see the [package README](packages/bunvue/README.md#benchmark) for the caveats.

## Commands

```sh
bun install
bun test                                   # the whole suite, builds the examples
bun run typecheck                          # tsc over packages/bunvue
bun run bench                              # the micro benchmark table

bun run --cwd examples/basic dev           # bun server.ts --dev
bun run --cwd examples/basic build         # bun --bun vite build --app
bun run --cwd examples/basic start         # bun server.ts
bun run --cwd examples/basic typecheck     # vue-tsc over the app
```

Requires Bun 1.4 or newer. Node 25 is only needed to run the benchmark's Fastify
comparison.

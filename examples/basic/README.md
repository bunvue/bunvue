# bunvue basic example

A minimal bunvue app with a layout, a typed `context.ts`, page actions, streaming,
client only and server only pages, and redirect and status signals.

```sh
bunx giget@latest gh:bunvue/bunvue/examples/basic my-app --install
cd my-app
bun run dev         # bun server.ts --dev, Vite in process with HMR
bun run build       # client and SSR build into dist/
bun run start       # production server on port 3000
bun run typecheck   # vue-tsc over the app
bun run lint        # eslint over the app
bun run format      # prettier over the app
```

ESLint and Prettier
come configured, so `bun run lint` and `bun run format` work out of the box.

Styling uses Tailwind CSS v4 through `@tailwindcss/vite`, with the stylesheet in `client/main.css`.

Requires Bun 1.4 or newer.

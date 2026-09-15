import { resolve } from 'node:path'
import { unflatten } from 'devalue'
import type { BunvueApp } from '../src/index.ts'

export const exampleRoot = resolve(import.meta.dirname, '..', '..', '..', 'examples', 'basic')

/** Builds examples/basic with Vite, the same way `bun run build` does. */
export function buildExample(): void {
  const result = Bun.spawnSync({
    cmd: ['bun', '--bun', 'vite', 'build', '--app'],
    cwd: exampleRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(`vite build failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`)
  }
}

export interface StartedExample {
  app: BunvueApp<unknown>
  origin: string
  stop: () => Promise<void>
}

/** Starts the example on an ephemeral port and returns its origin. */
export async function startExample(): Promise<StartedExample> {
  const { main } = (await import(resolve(exampleRoot, 'server.ts'))) as {
    main: (dev: boolean) => Promise<BunvueApp<unknown>>
  }
  const app = await main(false)
  const server = app.serve({ port: 0 })
  const origin = server.url.toString().replace(/\/$/, '')
  return {
    app,
    origin,
    stop: () => app.close(),
  }
}

/** The id of the hydration JSON block, mirrored from `src/serialize.ts`. */
export const HYDRATION_ID = '__bunvue__'

const BLOCK =
  /<script type="application\/json" id="__bunvue__" data-format="(json|devalue)">([\s\S]*?)<\/script>/

export interface Hydration {
  format: 'json' | 'devalue'
  /** The raw text content of the block, exactly as the server wrote it. */
  text: string
  /** JSON text of the `route` field, before any devalue revival. */
  payloadText: string
  /** The revived route payload. */
  route: unknown
  /** The revived route table. */
  routes: unknown
  /** The runtime config, always plain JSON whatever the format is. */
  runtimeConfig: unknown
}

/** Reads the hydration JSON block out of an SSR response, the way mount does. */
export function readHydration(html: string): Hydration {
  const match = BLOCK.exec(html)
  if (!match) {
    throw new Error(`no hydration block found (#${HYDRATION_ID})`)
  }
  const format = match[1] as 'json' | 'devalue'
  const text = match[2] as string
  const block = JSON.parse(text) as {
    route: unknown
    routes: unknown
    runtimeConfig: unknown
  }
  return {
    format,
    text,
    payloadText: JSON.stringify(block.route),
    route: format === 'devalue' ? unflatten(block.route as unknown[]) : block.route,
    routes: format === 'devalue' ? unflatten(block.routes as unknown[]) : block.routes,
    runtimeConfig: block.runtimeConfig,
  }
}

/** JSON text of the hydration payload in an SSR response. */
export function hydrationPayload(html: string): string {
  return readHydration(html).payloadText
}

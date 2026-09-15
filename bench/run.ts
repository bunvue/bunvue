/**
 * Vue 3 SSR micro-benchmark: Bun.serve vs Fastify 5 on Node.
 *
 * Usage: bun run.ts [--duration 20] [--connections 64] [--only <variant>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const BOMBARDIER = join(process.env.HOME ?? '', 'go/bin/bombardier')
const BUN = process.execPath
const NODE = 'node'

interface Variant {
  name: string
  runtime: 'bun' | 'node'
  script: string
  /** Variants sharing a group must return byte-identical bodies. */
  group: string
}

const VARIANTS: Variant[] = [
  { name: 'bun-static', runtime: 'bun', script: 'servers/bun-static.ts', group: 'static' },
  { name: 'node-static', runtime: 'node', script: 'servers/node-static.mjs', group: 'static' },
  { name: 'bun', runtime: 'bun', script: 'servers/bun.ts', group: 'ssr' },
  { name: 'node', runtime: 'node', script: 'servers/node.mjs', group: 'ssr' },
  { name: 'bun-head', runtime: 'bun', script: 'servers/bun-head.ts', group: 'ssr-head' },
  { name: 'node-head', runtime: 'node', script: 'servers/node-head.mjs', group: 'ssr-head' },
  {
    name: 'bun-head-prepared',
    runtime: 'bun',
    script: 'servers/bun-head-prepared.ts',
    group: 'ssr-head',
  },
]

function parseArgs() {
  const argv = Bun.argv.slice(2)
  let duration = 20
  let connections = 64
  let only: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--duration') duration = Number(argv[++i])
    else if (arg === '--connections') connections = Number(argv[++i])
    else if (arg === '--only') only = argv[++i]
    else if (arg.startsWith('--duration=')) duration = Number(arg.split('=')[1])
    else if (arg.startsWith('--connections=')) connections = Number(arg.split('=')[1])
    else if (arg.startsWith('--only=')) only = arg.split('=')[1]
    else throw new Error(`unknown flag: ${arg}`)
  }
  return { duration, connections, only }
}

const { duration, connections, only } = parseArgs()

async function ensureTreeBuilt() {
  if (existsSync(join(ROOT, 'tree/dist/entry.js'))) return
  console.log('tree/dist/entry.js missing, building...')
  const proc = Bun.spawn([BUN, '--bun', 'vite', 'build'], {
    cwd: join(ROOT, 'tree'),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`vite build failed with code ${code}`)
}

async function freePort(): Promise<number> {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  })
  const port = server.port
  server.stop(true)
  return port
}

async function waitForOk(url: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no attempt'
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status === 200) return await res.text()
      lastError = `status ${res.status}`
    } catch (error) {
      lastError = String(error)
    }
    await Bun.sleep(100)
  }
  throw new Error(`server at ${url} never returned 200: ${lastError}`)
}

function readRss(pid: number): { rss: number; peak: number } {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const rss = /VmRSS:\s+(\d+) kB/.exec(status)
    const peak = /VmHWM:\s+(\d+) kB/.exec(status)
    return {
      rss: rss ? Number(rss[1]) / 1024 : Number.NaN,
      peak: peak ? Number(peak[1]) / 1024 : Number.NaN,
    }
  } catch {
    return { rss: Number.NaN, peak: Number.NaN }
  }
}

interface BombardierResult {
  result: {
    rps: { mean: number }
    // latency values are microseconds
    latency: { mean: number; percentiles: Record<string, number> }
    req2xx: number
    others: number
  }
}

async function bombard(url: string, seconds: number, conns: number, json: boolean) {
  const args = [BOMBARDIER, '-c', String(conns), '-d', `${seconds}s`]
  if (json) args.push('-l', '-o', 'json', '--print', 'r')
  args.push(url)
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`bombardier exited ${code}: ${stderr}`)
  return stdout
}

interface Row {
  variant: string
  runtime: string
  rps: number
  p50: number
  p99: number
  rss: number
  peak: number
  bytes: number
  non2xx: number
}

const bodies = new Map<string, { variant: string; body: string }>()
const rows: Row[] = []

function assertIdenticalBody(variant: Variant, body: string) {
  const seen = bodies.get(variant.group)
  if (!seen) {
    bodies.set(variant.group, { variant: variant.name, body })
    return
  }
  if (seen.body === body) return
  console.error(`\nFATAL: body mismatch in group "${variant.group}"`)
  console.error(`  ${seen.variant}: ${Buffer.byteLength(seen.body)} bytes`)
  console.error(`  ${variant.name}: ${Buffer.byteLength(body)} bytes`)
  const limit = Math.min(seen.body.length, body.length)
  let i = 0
  while (i < limit && seen.body[i] === body[i]) i++
  console.error(`  first difference at offset ${i}`)
  console.error(
    `  ${seen.variant} : ...${JSON.stringify(seen.body.slice(Math.max(0, i - 60), i + 60))}`,
  )
  console.error(`  ${variant.name} : ...${JSON.stringify(body.slice(Math.max(0, i - 60), i + 60))}`)
  process.exit(1)
}

async function runVariant(variant: Variant) {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  const cmd =
    variant.runtime === 'bun'
      ? [BUN, join(ROOT, variant.script)]
      : [NODE, join(ROOT, variant.script)]

  console.log(`\n=== ${variant.name} (port ${port}) ===`)
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const body = await waitForOk(url)
    const bytes = Buffer.byteLength(body)
    assertIdenticalBody(variant, body)
    console.log(`  body ${bytes} bytes, warming up ${Math.min(5, duration)}s...`)

    await bombard(url, Math.min(5, duration), connections, false)
    console.log(`  measuring ${duration}s at c=${connections}...`)
    const raw = await bombard(url, duration, connections, true)
    const parsed = JSON.parse(raw) as BombardierResult
    const r = parsed.result
    const pct = r.latency?.percentiles ?? {}
    if (pct['50'] === undefined || pct['99'] === undefined)
      throw new Error(`unexpected bombardier JSON shape: ${raw.slice(0, 400)}`)

    const { rss, peak } = readRss(proc.pid)
    const non2xx = r.others ?? 0
    rows.push({
      variant: variant.name,
      runtime: variant.runtime === 'bun' ? 'Bun' : 'Node + Fastify',
      rps: r.rps.mean,
      p50: pct['50'] / 1000,
      p99: pct['99'] / 1000,
      rss,
      peak,
      bytes,
      non2xx,
    })
    console.log(
      `  ${r.rps.mean.toFixed(0)} req/s, p50 ${(pct['50'] / 1000).toFixed(2)} ms, p99 ${(pct['99'] / 1000).toFixed(2)} ms, RSS ${rss.toFixed(1)} MB`,
    )
  } finally {
    proc.kill()
    await proc.exited
  }
}

async function pkgVersion(name: string): Promise<string> {
  try {
    const json = JSON.parse(
      await readFile(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
    )
    return json.version
  } catch {
    return 'unknown'
  }
}

async function capture(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.trim()
}

function table(): string {
  const head =
    '| variant | runtime | req/s | p50 ms | p99 ms | RSS MB | peak RSS MB | bytes/response |'
  const sep = '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  const body = rows.map(
    (r) =>
      `| ${r.variant} | ${r.runtime} | ${r.rps.toFixed(0)} | ${r.p50.toFixed(2)} | ${r.p99.toFixed(2)} | ${r.rss.toFixed(1)} | ${r.peak.toFixed(1)} | ${r.bytes} |`,
  )
  return [head, sep, ...body].join('\n')
}

await ensureTreeBuilt()

const selected = only ? VARIANTS.filter((v) => v.name === only) : VARIANTS
if (selected.length === 0) {
  console.error(`unknown variant "${only}", pick one of: ${VARIANTS.map((v) => v.name).join(', ')}`)
  process.exit(1)
}

for (const variant of selected) await runVariant(variant)

const versions = {
  bun: await capture([BUN, '--version']),
  node: await capture([NODE, '--version']),
  vue: await pkgVersion('vue'),
  fastify: await pkgVersion('fastify'),
  unhead: await pkgVersion('@unhead/vue'),
}

const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '')
const md = [
  `# Vue 3 SSR bench, ${stamp}`,
  '',
  `Connections: ${connections}, duration: ${duration}s per variant, 5s warmup, loopback 127.0.0.1.`,
  '',
  table(),
  '',
  '## Versions',
  '',
  `- Bun ${versions.bun}`,
  `- Node ${versions.node}`,
  `- vue ${versions.vue}`,
  `- fastify ${versions.fastify}`,
  `- @unhead/vue ${versions.unhead}`,
  `- os ${process.platform} ${process.arch}, ${navigator.hardwareConcurrency} logical CPUs`,
  '',
].join('\n')

mkdirSync(join(ROOT, 'results'), { recursive: true })
const outPath = join(ROOT, 'results', `${stamp}.md`)
writeFileSync(outPath, md)

console.log(`\n${md}`)
console.log(`written to ${outPath}`)

import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BunvueOptions, I18nConfig, SerializableViteConfig } from './types.ts'

const VITE_CONFIG_JSON = 'vite.config.json'

const STALE_I18N_FILES = ['i18n.config.ts', 'i18n.config.js']

/** Roots already warned about, so a dev refresh does not repeat the warning. */
const warnedStaleI18nRoots = new Set<string>()

/**
 * The i18n config used to be a file in the Vite root, bundled into the SSR
 * build. It is the `i18n` option of `createBunvue` now, so a leftover file
 * would silently do nothing.
 */
export function warnStaleI18nConfig(viteRoot: string | undefined): void {
  if (!viteRoot || warnedStaleI18nRoots.has(viteRoot) || !existsSync(viteRoot)) {
    return
  }
  if (!STALE_I18N_FILES.some((name) => existsSync(join(viteRoot, name)))) {
    return
  }
  warnedStaleI18nRoots.add(viteRoot)
  console.warn(
    '[bunvue] i18n.config.ts is no longer read, pass the i18n option to createBunvue instead',
  )
}

/** Accepts a path, a file path or a `file:` URL and returns a directory. */
export function resolveRoot(input: string | URL): string {
  let root = typeof input === 'string' ? input : input.toString()
  if (root.startsWith('file:')) {
    root = fileURLToPath(root)
  }
  root = resolve(root)
  if (existsSync(root) && lstatSync(root).isFile()) {
    root = dirname(root)
  }
  return root
}

/** Walks up from `from` looking for the nearest directory with a package.json. */
export function findPackageDir(from: string): string {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return resolve(from)
    }
    dir = parent
  }
}

/** Locates `dist/vite.config.json` (or `build/`, or one level deeper). */
export function findViteConfigJson(
  appRoot: string,
  folderNames: string[] = ['dist', 'build'],
): string | null {
  for (const folderName of folderNames) {
    const folder = join(appRoot, folderName)

    let configPath = join(folder, VITE_CONFIG_JSON)
    if (existsSync(configPath)) {
      return configPath
    }

    try {
      for (const entry of readdirSync(folder)) {
        const entryPath = join(folder, entry)
        if (lstatSync(entryPath).isDirectory()) {
          configPath = join(entryPath, VITE_CONFIG_JSON)
          if (existsSync(configPath)) {
            return configPath
          }
        }
      }
    } catch {
      // Folder missing or unreadable, try the next candidate
    }

    configPath = join(appRoot, 'client', folderName, VITE_CONFIG_JSON)
    if (existsSync(configPath)) {
      return configPath
    }
  }
  return null
}

export interface ResolvedConfig {
  root: string
  appRoot: string
  dev: boolean
  base: string
  assetsDir: string
  clientOutDir: string
  ssrOutDir: string
  ssrEntry: string
  viteConfig: SerializableViteConfig
  /** The `i18n` option, as passed to `createBunvue`. */
  i18n?: I18nConfig
}

function resolveIfRelative(path: string, from: string): string {
  return isAbsolute(path) ? path : resolve(from, path)
}

/**
 * Reads the build-time `dist/vite.config.json` and resolves every dist path
 * against the application package root.
 */
export async function resolveProdConfig(options: BunvueOptions<unknown>): Promise<ResolvedConfig> {
  const root = resolveRoot(options.root)
  const appRoot = findPackageDir(root)
  const configPath = findViteConfigJson(appRoot)
  if (!configPath) {
    throw new Error(
      `bunvue: failed to load the cached Vite configuration. Searched in ${appRoot}/{dist,build}.\n` +
        "Run 'vite build --app' first, or pass { dev: true }.",
    )
  }
  const viteConfig = JSON.parse(await readFile(configPath, 'utf8')) as SerializableViteConfig

  const outDirs = viteConfig.bunvue?.outDirs ?? {}
  const clientOutDir = resolveIfRelative(outDirs.client ?? viteConfig.build.outDir, appRoot)
  const ssrOutDir = resolveIfRelative(
    outDirs.ssr ?? join(dirname(viteConfig.build.outDir), 'server'),
    appRoot,
  )

  if (!existsSync(clientOutDir)) {
    throw new Error(`bunvue: no client bundle found at ${clientOutDir}.`)
  }
  if (!existsSync(ssrOutDir)) {
    throw new Error(`bunvue: no SSR bundle found at ${ssrOutDir}.`)
  }

  const base = viteConfig.base && viteConfig.base !== '' ? viteConfig.base : '/'

  // The Vite root is a build time path, so it only exists when the app is run
  // from the directory it was built in. Nothing to warn about otherwise.
  warnStaleI18nConfig(resolveIfRelative(viteConfig.root, appRoot))

  return {
    root,
    appRoot,
    dev: false,
    base: base.startsWith('http') ? new URL(base).pathname : base,
    assetsDir: viteConfig.build.assetsDir || 'assets',
    clientOutDir,
    ssrOutDir,
    ssrEntry: viteConfig.bunvue?.entryPaths?.ssr ?? '$app/index.ts',
    viteConfig,
    i18n: options.i18n,
  }
}

const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cts',
  'vite.config.cjs',
]

/** Finds the nearest `vite.config.*` in one of the candidate directories. */
export function findViteConfigFile(dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of VITE_CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return null
}

/** Everything dev mode needs from the Vite configuration. */
export interface ResolvedDevConfig {
  /** The directory passed as `options.root`. */
  root: string
  /** Nearest package directory above `root`. */
  appRoot: string
  dev: true
  /** Absolute path of the `vite.config.*` file that was found. */
  configFile: string
  /** The Vite root (`root` in vite.config, e.g. `<appRoot>/client`). */
  viteRoot: string
  /** Absolute public directory, or `false` when disabled. */
  publicDir: string | false
  base: string
  assetsDir: string
  /** SSR entry, from `environments.ssr.build.rollupOptions.input`. */
  ssrEntry: string
  /** The `i18n` option, as passed to `createBunvue`. */
  i18n?: I18nConfig
}

function firstInput(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input
  }
  if (Array.isArray(input)) {
    return input.find((value) => typeof value === 'string') as string | undefined
  }
  if (input && typeof input === 'object') {
    return Object.values(input as Record<string, unknown>).find(
      (value) => typeof value === 'string',
    ) as string | undefined
  }
  return undefined
}

/**
 * Resolves the Vite configuration for dev mode.
 *
 * Vite resolves a relative `root` against `process.cwd()`, which would be wrong
 * whenever the server is started from somewhere other than the app directory,
 * so the config file is loaded once to read its `root` and an absolute one is
 * passed back into `resolveConfig`.
 */
export async function resolveDevConfig(
  options: BunvueOptions<unknown>,
): Promise<ResolvedDevConfig> {
  const root = resolveRoot(options.root)
  const appRoot = findPackageDir(root)
  const configFile = findViteConfigFile([root, appRoot])
  if (!configFile) {
    throw new Error(
      `bunvue: no vite.config.{ts,js,mts,mjs} found in ${root} or ${appRoot}. ` +
        'Dev mode needs one.',
    )
  }

  const { loadConfigFromFile, resolveConfig } = await import('vite')
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile)
  const declaredRoot = loaded?.config.root
  const viteRootHint = resolve(dirname(configFile), declaredRoot ?? '.')

  const resolved = await resolveConfig(
    { configFile, root: viteRootHint },
    'serve',
    'development',
    'development',
  )

  const ssrBuild = resolved.environments?.ssr?.build as
    { rollupOptions?: { input?: unknown } } | undefined
  const base = resolved.base && resolved.base !== '' ? resolved.base : '/'

  warnStaleI18nConfig(resolved.root)

  return {
    root,
    appRoot,
    dev: true,
    configFile,
    viteRoot: resolved.root,
    publicDir: resolved.publicDir === '' ? false : resolved.publicDir,
    base: base.startsWith('http') ? new URL(base).pathname : base,
    assetsDir: resolved.build.assetsDir || 'assets',
    ssrEntry: firstInput(ssrBuild?.rollupOptions?.input) ?? '$app/index.ts',
    i18n: options.i18n,
  }
}

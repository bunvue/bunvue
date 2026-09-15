import { writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { Plugin, ResolvedConfig, Rollup, UserConfig } from 'vite'
import { findPackageDir } from '../config.ts'
import type { BunvueViteConfig, SerializableViteConfig } from '../types.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Small deep merge, `source` wins. */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value
  }
  return out as T
}

function clientEnvironment(dev: boolean, outDir: string): Record<string, unknown> {
  return {
    build: {
      outDir: `${outDir}/client`,
      minify: !dev,
      sourcemap: dev,
      manifest: true,
    },
  }
}

function ssrEnvironment(dev: boolean, outDir: string, entry: string): Record<string, unknown> {
  return {
    build: {
      outDir: `${outDir}/server`,
      ssr: true,
      minify: !dev,
      sourcemap: dev,
      emitAssets: true,
      rollupOptions: {
        input: { index: entry },
      },
    },
  }
}

export interface EnvironmentsPluginOptions {
  /** SSR entry module, defaults to the `$app/index.ts` virtual module. */
  clientModule?: string
}

/**
 * Sets up the client and SSR build environments, the two-pass app builder and
 * the `dist/vite.config.json` manifest the runtime reads in production.
 */
export function bunvueEnvironments(options: EnvironmentsPluginOptions = {}): Plugin {
  const clientModule = options.clientModule ?? '$app/index.ts'
  let jsonFilePath: string | undefined
  let configToWrite: SerializableViteConfig | undefined

  return {
    name: 'bunvue:environments',
    enforce: 'pre',
    config(rawConfig: UserConfig, { mode, command }): void {
      const isDevMode = mode === 'development'
      const outDir = rawConfig.build?.outDir ?? 'dist'

      rawConfig.environments ??= {}
      rawConfig.environments.client = deepMerge(
        clientEnvironment(isDevMode, outDir),
        (rawConfig.environments.client ?? {}) as Record<string, unknown>,
      )
      rawConfig.environments.ssr = deepMerge(
        ssrEnvironment(isDevMode, outDir, clientModule),
        (rawConfig.environments.ssr ?? {}) as Record<string, unknown>,
      )

      // bunvue's client/virtual code must go through Vite so that
      // `import.meta.env.SSR` is replaced in the SSR bundle. Vue and friends
      // stay external so there is a single copy at runtime.
      rawConfig.ssr ??= {}
      const noExternal = rawConfig.ssr.noExternal
      if (noExternal === true) {
        // Everything is bundled already
      } else if (Array.isArray(noExternal)) {
        rawConfig.ssr.noExternal = [...noExternal, /^bunvue/]
      } else if (noExternal) {
        rawConfig.ssr.noExternal = [noExternal, /^bunvue/]
      } else {
        rawConfig.ssr.noExternal = [/^bunvue/]
      }
      const external = rawConfig.ssr.external
      const defaults = ['vue', 'vue-router', '@unhead/vue', 'devalue']
      if (Array.isArray(external)) {
        rawConfig.ssr.external = [...new Set([...external, ...defaults])]
      } else if (!external) {
        rawConfig.ssr.external = defaults
      }

      rawConfig.builder ??= {}
      rawConfig.builder.buildApp ??= async (builder) => {
        await builder.build(builder.environments.client)
        await builder.build(builder.environments.ssr)
      }

      if (command === 'build') {
        rawConfig.build ??= {}
        rawConfig.build.rollupOptions ??= {}
        rawConfig.build.rollupOptions.onwarn = onwarn
      }
    },
    configResolved(config: ResolvedConfig): void {
      const { base, build, mode, root } = config
      if (mode !== 'production') {
        return
      }

      const appRoot = findPackageDir(root)
      const bunvue: BunvueViteConfig = { outDirs: {}, entryPaths: {} }

      for (const [envName, envConfig] of Object.entries(config.environments)) {
        const envBuild = envConfig.build as
          { outDir?: string; rollupOptions?: { input?: Record<string, string> } } | undefined
        if (envBuild?.outDir) {
          bunvue.outDirs![envName] = envBuild.outDir
        }
        const input = envBuild?.rollupOptions?.input
        if (input && typeof input === 'object') {
          const entry = Object.values(input).find(Boolean)
          if (entry) {
            bunvue.entryPaths![envName] = entry
          }
        }
      }

      configToWrite = makeRelative(appRoot, {
        base,
        root,
        build: { assetsDir: build.assetsDir, outDir: bunvue.outDirs?.client ?? 'dist/client' },
        bunvue,
      })

      const outDirs = Object.values(configToWrite.bunvue?.outDirs ?? {})
      const commonDistFolder =
        outDirs.length > 1
          ? findCommonPath(outDirs)
          : outDirs.length === 1
            ? dirname(outDirs[0])
            : dirname(configToWrite.build.outDir)

      jsonFilePath = isAbsolute(commonDistFolder)
        ? join(commonDistFolder, 'vite.config.json')
        : join(appRoot, commonDistFolder, 'vite.config.json')
    },
    async writeBundle(): Promise<void> {
      if (!jsonFilePath || !configToWrite) {
        return
      }
      await writeFile(jsonFilePath, JSON.stringify(configToWrite, undefined, 2), 'utf8')
    },
  }
}

export function findCommonPath(paths: string[]): string {
  if (paths.length === 1) {
    return paths[0]
  }
  const segments = paths.map((path) => path.split(sep))
  const minLength = Math.min(...segments.map((parts) => parts.length))
  const common: string[] = []
  for (let i = 0; i < minLength; i++) {
    const segment = segments[0][i]
    if (segments.every((parts) => parts[i] === segment)) {
      common.push(segment)
    } else {
      break
    }
  }
  return common.join(sep)
}

function makeRelative(appRoot: string, config: SerializableViteConfig): SerializableViteConfig {
  const absoluteRoot = config.root
  const toRelative = (path: string): string =>
    relative(appRoot, isAbsolute(path) ? path : join(absoluteRoot, path))

  return {
    ...config,
    root: relative(appRoot, absoluteRoot),
    build: { ...config.build, outDir: toRelative(config.build.outDir) },
    bunvue: config.bunvue
      ? {
          ...config.bunvue,
          outDirs: config.bunvue.outDirs
            ? Object.fromEntries(
                Object.entries(config.bunvue.outDirs).map(([key, dir]) => [key, toRelative(dir)]),
              )
            : undefined,
        }
      : undefined,
  }
}

function onwarn(
  warning: Rollup.RollupLog,
  rollupWarn: (warning: string | Rollup.RollupLog) => void,
): void {
  // rolldown reports these as IMPORT_IS_UNDEFINED, rollup as MISSING_EXPORT
  if (
    !(
      (warning.code === 'MISSING_EXPORT' || warning.code === 'IMPORT_IS_UNDEFINED') &&
      (warning.message?.includes?.('scrollBehavior') ||
        warning.message?.includes?.('configure') ||
        warning.message?.includes?.('mount'))
    ) &&
    !(
      warning.code === 'PLUGIN_WARNING' &&
      warning.message?.includes?.('dynamic import will not move module into another chunk')
    ) &&
    !(warning.code === 'UNUSED_EXTERNAL_IMPORT' && warning.exporter === 'vue')
  ) {
    rollupWarn(warning)
  }
}

import { afterAll, describe, expect, it } from 'bun:test'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Every `examples/*` folder has to work on its own once copied out of the
 * monorepo with `giget`, so nothing in it may reach back into the workspace.
 */

interface PackageJson {
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface TsConfig {
  extends?: unknown
  include?: string[]
  files?: string[]
  compilerOptions?: { paths?: Record<string, string[]> }
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const examplesRoot = join(repoRoot, 'examples')
const packageRoot = resolve(import.meta.dirname, '..')
const bunvuePkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageJson

/** Dependencies an example shares with bunvue, whose ranges must not drift. */
const SHARED = ['vue', 'vue-router', '@unhead/vue', 'vite', '@vitejs/plugin-vue', 'typescript']

const examples = readdirSync(examplesRoot)
  .filter((name) => existsSync(join(examplesRoot, name, 'package.json')))
  .sort()

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function allDependencies(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies }
}

/** True when `path`, resolved against `root`, stays inside `root`. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, resolve(root, path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Source files of an example, skipping `node_modules`, `dist` and dot folders. */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|vue|js)$/.test(entry)) found.push(path)
  }
  return found
}

/** `from '...'`, `import '...'` and `import('...')` with a relative specifier. */
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]*)['"]/g

function relativeSpecifiers(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(RELATIVE_SPECIFIER)].map((match) => match[1]!)
}

it('finds the examples', () => {
  expect(examples).toContain('basic')
  expect(bunvuePkg.version).toBeString()
})

it('scans relative imports, so the specifier check is not vacuous', () => {
  const all = examples.flatMap((name) =>
    sourceFiles(join(examplesRoot, name)).flatMap(relativeSpecifiers),
  )
  expect(all.length).toBeGreaterThan(0)
})

for (const name of examples) {
  const root = join(examplesRoot, name)

  describe(`examples/${name} stands alone`, () => {
    const pkg = readJson<PackageJson>(join(root, 'package.json'))
    const deps = allDependencies(pkg)

    it('uses no workspace, catalog, file, link or relative dependency specs', () => {
      const offending = Object.entries(deps).filter(([, spec]) =>
        /^(workspace:|catalog:|file:|link:|\.{0,2}\/)/.test(spec),
      )
      expect(offending).toEqual([])
    })

    it('depends on a bunvue range satisfied by the local package version', () => {
      const range = pkg.dependencies?.bunvue
      expect(range).toBeString()
      expect(Bun.semver.satisfies(bunvuePkg.version!, range!)).toBe(true)
    })

    it('uses the same ranges as bunvue for shared dependencies', () => {
      const reference = bunvuePkg.devDependencies ?? {}
      for (const dep of SHARED) {
        if (!(dep in deps)) continue
        expect({ dep, range: deps[dep] }).toEqual({ dep, range: reference[dep] })
      }
    })

    it('has a tsconfig with no extends and no paths outside the folder', () => {
      const tsconfig = readJson<TsConfig>(join(root, 'tsconfig.json'))
      expect(tsconfig.extends).toBeUndefined()
      const entries = [
        ...(tsconfig.include ?? []),
        ...(tsconfig.files ?? []),
        ...Object.values(tsconfig.compilerOptions?.paths ?? {}).flat(),
      ]
      expect(entries.filter((entry) => !isInside(root, entry))).toEqual([])
    })

    it('only imports relative paths inside the folder', () => {
      const escaping = sourceFiles(root).flatMap((file) =>
        relativeSpecifiers(file)
          .filter((spec) => !isInside(root, resolve(dirname(file), spec)))
          .map((spec) => `${relative(root, file)}: ${spec}`),
      )
      expect(escaping).toEqual([])
    })

    it('ships a .gitignore and a README that names the starter', () => {
      expect(existsSync(join(root, '.gitignore'))).toBe(true)
      const readme = readFileSync(join(root, 'README.md'), 'utf8')
      // Only `basic` is the giget starter, the others are demos run from the repo.
      const giget = `gh:bunvue/bunvue/examples/${basename(root)}`
      if (name === 'basic') {
        expect(readme).toContain(giget)
      } else {
        expect(readme).not.toContain('giget')
        expect(readme).toContain('../basic/README.md')
      }
    })
  })
}

/**
 * The starter carries copies of the root lint and format configs so a giget
 * copy gets the same tooling. They have to stay byte for byte identical, or
 * the two would format differently.
 */
describe('examples/basic tooling', () => {
  const root = join(examplesRoot, 'basic')
  const pkg = readJson<PackageJson>(join(root, 'package.json'))

  it.each(['eslint.config.js', '.prettierrc'])('%s matches the repo root', (file) => {
    expect(readFileSync(join(root, file), 'utf8')).toBe(readFileSync(join(repoRoot, file), 'utf8'))
  })

  it('has lint and format scripts and their dependencies', () => {
    expect(pkg.scripts).toMatchObject({ lint: 'eslint .', format: 'prettier --write .' })
    const rootPkg = readJson<PackageJson>(join(repoRoot, 'package.json'))
    for (const dep of ['eslint', 'prettier', 'eslint-plugin-vue', 'typescript-eslint']) {
      expect({ dep, range: pkg.devDependencies?.[dep] }).toEqual({
        dep,
        range: rootPkg.devDependencies?.[dep],
      })
    }
  })
})

/**
 * Copies examples/basic outside the workspace and installs bunvue from a packed
 * tarball, which is what an npm install would hand the app, then builds it.
 * Only bunvue comes from disk. Everything else resolves from Bun's cache or the
 * registry, the same as for a fresh giget copy.
 */
describe('examples/basic outside the monorepo', () => {
  const temp = mkdtempSync(join(tmpdir(), 'bunvue-example-'))
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  function run(cmd: string[], cwd: string): string {
    const result = Bun.spawnSync({ cmd, cwd, stdout: 'pipe', stderr: 'pipe' })
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`
    if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed:\n${output}`)
    return output
  }

  it('installs from the packed package and builds', () => {
    const pack = join(temp, 'pack')
    const app = join(temp, 'app')
    run(['bun', 'pm', 'pack', '--destination', pack, '--quiet'], packageRoot)
    const tarball = readdirSync(pack).find((file) => file.endsWith('.tgz'))
    expect(tarball).toBeString()

    cpSync(join(examplesRoot, 'basic'), app, {
      recursive: true,
      filter: (source) => !/[\\/](node_modules|dist)$/.test(source),
    })
    const pkgPath = join(app, 'package.json')
    const pkg = readJson<PackageJson>(pkgPath)
    pkg.dependencies = { ...pkg.dependencies, bunvue: `file:${join(pack, tarball!)}` }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    run(['bun', 'install'], app)
    // A real copy, not a symlink back into the workspace.
    const installed = lstatSync(join(app, 'node_modules', 'bunvue'))
    expect(installed.isSymbolicLink()).toBe(false)
    expect(installed.isDirectory()).toBe(true)
    expect(readFileSync(join(app, 'node_modules', 'bunvue', 'package.json'), 'utf8')).toContain(
      '"name": "bunvue"',
    )

    run(['bun', '--bun', 'vite', 'build', '--app'], app)
    expect(existsSync(join(app, 'dist', 'server', 'index.js'))).toBe(true)
    expect(existsSync(join(app, 'dist', 'client', 'index.html'))).toBe(true)
  })
})

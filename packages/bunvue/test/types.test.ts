/* eslint-disable @typescript-eslint/no-unused-expressions, @typescript-eslint/no-empty-object-type */
import { describe, expect, it } from 'bun:test'
import { RouteContext } from '../src/context.ts'
import { useRouteContext } from '../src/client.ts'
import type { ContextInit, RouteContextLike, RouteEntry } from '../src/types.ts'

/**
 * Type level checks. `bun test` only runs the assertions at the bottom, since
 * `typeChecks()` is never called: the `@ts-expect-error` comments are what
 * `tsc --noEmit` (the package's `typecheck` script) verifies, `test/` being
 * part of the tsconfig.
 */

interface AppServer {
  db: { todoList: string[] }
}

interface AppState {
  foo: string
  count: number
}

/** An app narrowing both generics. This failed with TS2430 before. */
interface AppCtx extends RouteContextLike<AppServer, AppState> {}

/** Omitting a property used to leave the rest `unknown` (TS18046). */
type WithoutServer = Omit<AppCtx, 'server'>

function typeChecks(): void {
  const ctx = null as unknown as AppCtx

  // `state` is the app's own type, on reads and writes.
  const foo: string = ctx.state.foo
  const count: number = ctx.state.count
  ctx.state.foo = 'other'

  // `server` stays optional, and typed.
  const todos: string[] | undefined = ctx.server?.db.todoList

  // @ts-expect-error `bar` is not part of AppState
  ctx.state.bar

  // @ts-expect-error the base interface carries no catch-all index signature
  ctx.whateverTheAppNeverDeclared

  const trimmed = null as unknown as WithoutServer
  const stillTyped: number = trimmed.state.count
  // @ts-expect-error `server` was omitted
  trimmed.server

  // `useRouteContext()` takes the app's own context type.
  const appCtx = useRouteContext<AppCtx>()
  const typedFoo: string = appCtx.state.foo
  // @ts-expect-error still no catch-all on the app's context
  appCtx.notDeclaredAnywhere

  // Without one it carries the `context.ts` extras, as `unknown`.
  const anyCtx = useRouteContext()
  const actions = anyCtx.actions as { greet(name: string): string }
  const greeting: string = actions.greet('bunvue')

  void [foo, count, todos, stillTyped, typedFoo, greeting]
}

/** `context.ts` types its own state through `ContextInit`. */
const contextInit: ContextInit<AppServer, AppState> = {
  state: () => ({ foo: 'bar', count: 1 }),
  default: (ctx) => {
    ctx.state.count = ctx.server?.db.todoList.length ?? 0
  },
}

const route: RouteEntry = { id: 'index', name: 'index', path: '/', key: '*__/', meta: {} }

describe('typed route context', () => {
  it('carries the state type from context.ts onto the context', async () => {
    const ctx = await RouteContext.create({
      request: new Request('http://localhost/'),
      url: new URL('http://localhost/'),
      params: {},
      server: { db: { todoList: ['a', 'b'] } } satisfies AppServer,
      route,
      contextInit,
    })
    // Inferred as RouteContext<AppServer, AppState>, so this compiles.
    const typedFoo: string = ctx.state.foo
    expect(typedFoo).toBe('bar')
    expect(ctx.state.count).toBe(2)
  })

  it('leaves state null when context.ts has no state()', async () => {
    const ctx = await RouteContext.create({
      request: new Request('http://localhost/'),
      url: new URL('http://localhost/'),
      params: {},
      server: undefined,
      route,
    })
    expect(ctx.state).toBeNull()
  })

  it('keeps the type checks in this file compiled but unexecuted', () => {
    expect(typeof typeChecks).toBe('function')
    expect(typeof useRouteContext).toBe('function')
  })
})

import type { RouteContextLike } from 'bunvue/client'

interface AppServer {
  db: { todoList: string[] }
}

export interface AppState {
  todoList: string[]
  /** Only set with `?date=1`, to exercise the devalue hydration fallback. */
  generatedAt?: Date
}

export function state(): AppState {
  return { todoList: [] as string[] }
}

export const actions = {
  greet(name: string): string {
    return `Hello, ${name}!`
  },
}

export default async function context(ctx: RouteContextLike<AppServer, AppState>): Promise<void> {
  if (ctx.server && ctx.state) {
    ctx.state.todoList = ctx.server.db.todoList
  }
  // A Date cannot round trip through JSON, so this query flag pushes the
  // hydration payload onto the devalue fallback path.
  if (ctx.state && ctx.url?.searchParams.get('date') === '1') {
    ctx.state.generatedAt = new Date(0)
  }
}

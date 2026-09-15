import type { RouteContextLike } from 'bunvue/client'

export function state(): { visits: number } {
  return { visits: 0 }
}

export default async function context(ctx: RouteContextLike): Promise<void> {
  if (ctx.state) {
    ctx.state.visits = 1
  }
}

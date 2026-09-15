<script lang="ts">
import type { App } from 'vue'
import router from '$app/router.vue'

export const mount = '#root'

/**
 * The app's own error handler. bunvue installs its signal-swallowing handler
 * around this one after `configure()` runs, so `ctx.notFound()` still aborts
 * with a 404 while real errors still reach the app. The global array is what
 * the test observes.
 */
export function configure({ app }: { app: App }): void {
  app.config.errorHandler = (error: unknown): void => {
    const seen = ((globalThis as Record<string, unknown>).__bunvueAppErrors ??= []) as string[]
    seen.push(error instanceof Error ? error.message : String(error))
  }
}

export default router
</script>

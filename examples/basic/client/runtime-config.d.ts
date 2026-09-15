import 'bunvue/client'

/**
 * The shape of this app's `runtimeConfig`, merged into bunvue's empty
 * interface so `useRuntimeConfig()` is typed everywhere.
 */
declare module 'bunvue/client' {
  interface RuntimeConfig {
    siteName: string
    features: { newsletter: boolean }
  }
}

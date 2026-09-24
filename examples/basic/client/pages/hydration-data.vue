<template>
  <h1>Hydration data</h1>
  <div
    class="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm *:mb-0 dark:border-slate-800 dark:bg-slate-950"
  >
    <p>Fetches: {{ first.fetches }}</p>
    <p>At: {{ first.at }}</p>
    <p>Shared: {{ first.fetches === second.fetches }}</p>
  </div>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useHydrationData } from 'bunvue/client'
import { fetchDemoData } from '../demo-data.ts'

useHead({ title: 'Hydration data' })

// Both calls use the same key, so one render shares one fetch. The result
// travels in the hydration payload and the client reuses it while hydrating.
const [first, second] = await Promise.all([
  useHydrationData('demo:data', fetchDemoData),
  useHydrationData('demo:data', fetchDemoData),
])
</script>

<template>
  <h1>Hydration data</h1>
  <p>Fetches: {{ first.fetches }}</p>
  <p>At: {{ first.at }}</p>
  <p>Shared: {{ first.fetches === second.fetches }}</p>
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

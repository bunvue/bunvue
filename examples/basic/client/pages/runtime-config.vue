<template>
  <h1>Runtime config</h1>
  <div
    class="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm *:mb-0 dark:border-slate-800 dark:bg-slate-950"
  >
    <p>Site name: {{ config.siteName }}</p>
    <p>Newsletter: {{ config.features.newsletter }}</p>
    <p>Path: {{ ctx.url.pathname }}</p>
  </div>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext, useRuntimeConfig } from 'bunvue/client'

useHead({ title: 'Runtime config' })

const ctx = useRouteContext()
const config = useRuntimeConfig()
</script>

<template>
  <h1>Context</h1>
  <div
    class="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm *:mb-0 dark:border-slate-800 dark:bg-slate-950"
  >
    <p>Locale: {{ locale }}</p>
    <p>Path: {{ ctx.url.pathname }}</p>
    <p>{{ greeting }}</p>
  </div>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const locale = ctx.meta.locale ?? 'none'
const actions = ctx.actions as { greet(name: string): string }
const greeting = actions.greet('bunvue')
</script>

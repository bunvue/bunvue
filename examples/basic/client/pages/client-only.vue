<template>
  <h1>Client only</h1>
  <p>This route is rendered on the client only!</p>
  <div
    class="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm *:mb-0 dark:border-slate-800 dark:bg-slate-950"
  >
    <p>Path: {{ ctx.url.pathname }}</p>
  </div>
</template>

<script lang="ts">
export const clientOnly = true
</script>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

useHead({ title: 'Client only page' })
</script>

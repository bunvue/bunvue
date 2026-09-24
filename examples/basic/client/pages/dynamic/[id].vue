<template>
  <h1>Dynamic Route</h1>
  <div
    class="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm *:mb-0 dark:border-slate-800 dark:bg-slate-950"
  >
    <p>Item ID: {{ route.params.id }}</p>
    <p>Context param: {{ ctx.params.id }}</p>
    <p>Path: {{ ctx.url.pathname }}</p>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useRouteContext } from 'bunvue/client'

const route = useRoute()
const ctx = useRouteContext()
</script>

<template>
  <h1>{{ message }}</h1>
  <div class="mb-2 text-lg text-slate-500 dark:text-slate-400">
    <p>A minimal bunvue application.</p>
  </div>
  <div class="font-mono text-xs text-slate-400 dark:text-slate-500">
    <p>Path: {{ ctx.url.pathname }}</p>
  </div>
  <nav class="mt-8 grid gap-3 sm:grid-cols-2">
    <RouterLink
      v-for="demo in demos"
      :id="`to-${demo.name}`"
      :key="demo.name"
      :to="demo.to"
      class="flex flex-col gap-1 rounded-lg border border-slate-200 p-4 text-sm no-underline transition hover:border-emerald-500 hover:no-underline hover:shadow-sm dark:border-slate-800 dark:hover:border-emerald-500"
    >
      <strong class="font-mono text-slate-900 dark:text-white">{{ demo.name }}</strong>
      <span class="text-slate-500 dark:text-slate-400">{{ demo.about }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

const message = 'Welcome to bunvue!'
const ctx = useRouteContext()

const demos = [
  { name: 'using-data', to: '/using-data', about: 'Async setup with state from the server.' },
  { name: 'dynamic', to: '/dynamic/42', about: 'A route with a dynamic id param.' },
  { name: 'context', to: '/context', about: 'Typed context with meta and page actions.' },
  { name: 'client-only', to: '/client-only', about: 'Skips SSR and renders in the browser.' },
  { name: 'runtime-config', to: '/runtime-config', about: 'Config read when the server starts.' },
  { name: 'hydration-data', to: '/hydration-data', about: 'Fetched once, reused while hydrating.' },
]

useHead({ title: 'Welcome to bunvue!' })
</script>

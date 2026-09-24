<template>
  <div class="flex min-h-screen flex-col">
    <header
      class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80"
    >
      <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <RouterLink
          to="/"
          class="text-lg font-bold tracking-tight text-slate-900 no-underline hover:no-underline dark:text-white"
        >
          bun<span class="text-emerald-600 dark:text-emerald-400">vue</span>
        </RouterLink>
        <nav class="flex flex-wrap gap-1 text-sm">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="rounded-full px-3 py-1 text-slate-600 no-underline transition-colors hover:bg-slate-100 hover:text-slate-900 hover:no-underline dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            active-class="bg-emerald-50 text-emerald-700! dark:bg-emerald-500/10 dark:text-emerald-400!"
          >
            {{ link.label }}
          </RouterLink>
        </nav>
      </div>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div
        class="rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <slot />
      </div>
    </main>

    <footer class="px-4 pb-8 text-center text-xs text-slate-400 dark:text-slate-500">
      Built with bunvue, Vue and Tailwind CSS.
    </footer>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'

const links = [
  { to: '/using-data', label: 'Data' },
  { to: '/dynamic/42', label: 'Dynamic' },
  { to: '/context', label: 'Context' },
  { to: '/client-only', label: 'Client only' },
  { to: '/runtime-config', label: 'Config' },
  { to: '/hydration-data', label: 'Hydration' },
  { to: '/stream', label: 'Stream' },
  { to: '/form', label: 'Form' },
]
</script>

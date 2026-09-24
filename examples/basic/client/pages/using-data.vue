<template>
  <h2>Todo List</h2>
  <ul
    class="mb-6 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
  >
    <li
      v-for="(item, i) in todoList"
      :key="`item-${i}`"
      class="flex items-center gap-3 px-4 py-3 before:size-2 before:rounded-full before:bg-emerald-500"
    >
      {{ item }}
    </li>
  </ul>
  <div class="font-mono text-xs text-slate-400 dark:text-slate-500">
    <p>Path: {{ ctx.url.pathname }}</p>
  </div>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

useHead({ title: 'Todo List' })

const ctx = useRouteContext()

// Stands in for a real data fetch
await new Promise((resolve) => setTimeout(resolve, 1))

const todoList = (ctx.state?.todoList ?? []) as string[]
</script>

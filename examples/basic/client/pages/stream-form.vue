<template>
  <h1>Streamed form</h1>
  <div
    v-if="done"
    class="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
  >
    <p id="done">Saved.</p>
  </div>
  <form method="post" class="mt-6">
    <button type="submit">Save</button>
  </form>
</template>

<script lang="ts">
export const streaming = true
</script>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const done = ctx.url.searchParams.get('done') === '1'
</script>

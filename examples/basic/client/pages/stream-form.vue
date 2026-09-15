<template>
  <h1>Streamed form</h1>
  <p v-if="done" id="done">Saved.</p>
  <form method="post">
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

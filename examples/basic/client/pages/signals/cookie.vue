<template>
  <h1>Cookie</h1>
  <p>A response header was set from the page.</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

await Promise.resolve()

ctx.headers?.set('set-cookie', 'bunvue=1; Path=/')
</script>

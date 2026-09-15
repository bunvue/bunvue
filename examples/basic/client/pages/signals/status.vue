<template>
  <h1>Custom status</h1>
  <p>This page renders with a 404 status.</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

await Promise.resolve()

ctx.status = 404
</script>

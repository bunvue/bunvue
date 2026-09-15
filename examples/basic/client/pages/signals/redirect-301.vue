<template>
  <p>Never rendered</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

await Promise.resolve()

ctx.redirect('/', 301)
</script>

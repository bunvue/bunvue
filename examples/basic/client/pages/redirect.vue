<template>
  <p>Redirecting...</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

await Promise.resolve()

ctx.redirect('/')
</script>

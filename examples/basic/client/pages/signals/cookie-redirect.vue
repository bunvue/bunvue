<template>
  <p>Never rendered</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

await Promise.resolve()

ctx.headers?.append('set-cookie', 'visited=1; Path=/')
ctx.redirect('/')
</script>

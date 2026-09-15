<template>
  <h1>Proxy example</h1>
  <p>Path: {{ ctx.url.pathname }}</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
</script>

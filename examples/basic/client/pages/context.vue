<template>
  <h1>Context</h1>
  <p>Locale: {{ locale }}</p>
  <p>Path: {{ ctx.url.pathname }}</p>
  <p>{{ greeting }}</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const locale = ctx.meta.locale ?? 'none'
const actions = ctx.actions as { greet(name: string): string }
const greeting = actions.greet('bunvue')
</script>

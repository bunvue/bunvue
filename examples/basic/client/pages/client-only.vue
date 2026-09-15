<template>
  <h1>Client only</h1>
  <p>This route is rendered on the client only!</p>
  <p>Path: {{ ctx.url.pathname }}</p>
</template>

<script lang="ts">
export const clientOnly = true
</script>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

useHead({ title: 'Client only page' })
</script>

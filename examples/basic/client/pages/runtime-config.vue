<template>
  <h1>Runtime config</h1>
  <p>Site name: {{ config.siteName }}</p>
  <p>Newsletter: {{ config.features.newsletter }}</p>
  <p>Path: {{ ctx.url.pathname }}</p>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext, useRuntimeConfig } from 'bunvue/client'

useHead({ title: 'Runtime config' })

const ctx = useRouteContext()
const config = useRuntimeConfig()
</script>

<template>
  <h1>Index</h1>
  <p>Locale: {{ ctx.meta.locale }}</p>
  <p>Name: {{ route.name }}</p>
  <p>Params: {{ JSON.stringify(route.params) }}</p>
  <p>Path: {{ ctx.url.pathname }}</p>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const route = useRoute()
</script>

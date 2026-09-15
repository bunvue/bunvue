<template>
  <h1>Dynamic Route</h1>
  <p>Item ID: {{ route.params.id }}</p>
  <p>Context param: {{ ctx.params.id }}</p>
  <p>Path: {{ ctx.url.pathname }}</p>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useRouteContext } from 'bunvue/client'

const route = useRoute()
const ctx = useRouteContext()
</script>

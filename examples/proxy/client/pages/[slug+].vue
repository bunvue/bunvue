<template>
  <h1>Catch-all</h1>
  <p>Slug: {{ slug }}</p>
  <p>Route param: {{ JSON.stringify(route.params.slug) }}</p>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const route = useRoute()
const slug = ctx.params.slug
</script>

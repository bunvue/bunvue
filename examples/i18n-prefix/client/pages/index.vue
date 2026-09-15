<template>
  <h1>Index</h1>
  <p>Locale: {{ ctx.meta.locale }}</p>
  <p>Name: {{ route.name }}</p>
  <p>Params: {{ JSON.stringify(route.params) }}</p>
  <p>Path: {{ ctx.url.pathname }}</p>
  <nav>
    <RouterLink id="to-en" :to="localePath('index', 'en')">en</RouterLink>
    <RouterLink id="to-fi" :to="localePath('index', 'fi')">fi</RouterLink>
    <RouterLink id="to-about" :to="localePath('about')">about</RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { useLocaleRoutes, useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const route = useRoute()
const { localePath } = useLocaleRoutes()
</script>

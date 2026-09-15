<template>
  <h1>Product</h1>
  <p>Locale: {{ ctx.meta.locale }}</p>
  <p>Name: {{ route.name }}</p>
  <p>Params: {{ JSON.stringify(route.params) }}</p>
  <p>Context slug: {{ ctx.params.slug }}</p>
  <p>Path: {{ ctx.url.pathname }}</p>
  <nav>
    <a v-for="l in locales" :id="`switch-${l}`" :key="l" :href="switchLocalePath(l)">{{ l }}</a>
  </nav>
</template>

<script lang="ts">
export const i18n = {
  se: '/produkt/:slug',
  fi: '/tuote/:slug',
}
</script>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useLocaleRoutes, useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()
const route = useRoute()
const { locales, switchLocalePath } = useLocaleRoutes()
</script>

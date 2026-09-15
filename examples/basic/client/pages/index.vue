<template>
  <h1>{{ message }}</h1>
  <p>A minimal bunvue application.</p>
  <p>Path: {{ ctx.url.pathname }}</p>
  <nav>
    <RouterLink id="to-using-data" to="/using-data">using-data</RouterLink>
    <RouterLink id="to-dynamic" to="/dynamic/42">dynamic</RouterLink>
    <RouterLink id="to-context" to="/context">context</RouterLink>
    <RouterLink id="to-client-only" to="/client-only">client-only</RouterLink>
    <RouterLink id="to-runtime-config" to="/runtime-config">runtime-config</RouterLink>
    <RouterLink id="to-hydration-data" to="/hydration-data">hydration-data</RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

const message = 'Welcome to bunvue!'
const ctx = useRouteContext()

useHead({ title: 'Welcome to bunvue!' })
</script>

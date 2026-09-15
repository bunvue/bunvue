<template>
  <p>Never rendered</p>
</template>

<script setup lang="ts">
import { useRouteContext } from 'bunvue/client'

const ctx = useRouteContext()

ctx.notFound()
</script>

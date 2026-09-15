<template>
  <h1>Streamed page</h1>
  <p>{{ message }}</p>
</template>

<script lang="ts">
export const streaming = true
</script>

<script setup lang="ts">
import { useHead } from '@unhead/vue'

useHead({ title: 'Streamed page' })

const message = 'This response was streamed.'
</script>

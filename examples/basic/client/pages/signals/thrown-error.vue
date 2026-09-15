<template>
  <p>Never rendered</p>
</template>

<script setup lang="ts">
await Promise.resolve()

throw new Error('boom from a page')
</script>

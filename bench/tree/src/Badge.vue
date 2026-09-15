<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <span class="badge" :class="`badge--${label.toLowerCase()}`">{{ label }}</span>
</template>

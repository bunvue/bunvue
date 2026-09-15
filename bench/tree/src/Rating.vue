<script setup lang="ts">
const props = defineProps<{ value: number }>()
const stars = [1, 2, 3, 4, 5]
</script>

<template>
  <div class="rating" :aria-label="`Rated ${value} out of 5`">
    <span
      v-for="star in stars"
      :key="star"
      class="rating__star"
      :class="star <= props.value ? 'is-filled' : 'is-empty'"
      >{{ star <= props.value ? '*' : '.' }}</span
    >
  </div>
</template>

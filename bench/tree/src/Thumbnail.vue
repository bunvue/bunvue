<script setup lang="ts">
defineProps<{ src: string; alt: string; inStock: boolean }>()
</script>

<template>
  <figure class="thumb">
    <img class="thumb__img" :src="src" :alt="alt" width="160" height="160" loading="lazy" />
    <figcaption v-if="!inStock" class="thumb__oos">Out of stock</figcaption>
  </figure>
</template>

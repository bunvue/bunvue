<script setup lang="ts">
import { useHead } from '@unhead/vue'
import ProductList from './ProductList.vue'
import type { Product } from './products'

const props = defineProps<{ products: Product[] }>()

useHead({
  title: `Bench Store, ${props.products.length} products`,
  meta: [
    { property: 'og:title', content: 'Bench Store' },
    {
      property: 'og:description',
      content: `Browse ${props.products.length} deterministic products.`,
    },
    { name: 'description', content: `Browse ${props.products.length} deterministic products.` },
  ],
})
</script>

<template>
  <ProductList :products="products" />
</template>

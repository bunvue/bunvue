<script setup lang="ts">
import Badge from './Badge.vue'
import Price from './Price.vue'
import Rating from './Rating.vue'
import Thumbnail from './Thumbnail.vue'
import type { Product } from './products'

defineProps<{ product: Product }>()
</script>

<template>
  <article class="card" :data-id="product.id">
    <Thumbnail :src="product.thumbnail" :alt="product.name" :in-stock="product.inStock" />
    <div class="card__body">
      <h3 class="card__title">
        <a :href="`/p/${product.slug}`">{{ product.name }}</a>
      </h3>
      <Badge v-if="product.badge" :label="product.badge" />
      <Price
        :amount="product.price"
        :currency="product.currency"
        :discounted="product.badge === 'Sale'"
      />
      <Rating :value="product.rating" />
      <p class="card__meta">SKU {{ product.slug }}-{{ product.id }}</p>
    </div>
  </article>
</template>

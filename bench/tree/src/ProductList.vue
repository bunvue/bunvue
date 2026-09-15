<script setup lang="ts">
import ProductCard from './ProductCard.vue'
import type { Product } from './products'

defineProps<{ products: Product[] }>()

const nav = [
  { href: '/new', label: 'New arrivals' },
  { href: '/sale', label: 'Sale' },
  { href: '/men', label: 'Men' },
  { href: '/women', label: 'Women' },
  { href: '/kids', label: 'Kids' },
  { href: '/brands', label: 'Brands' },
  { href: '/stores', label: 'Stores' },
  { href: '/support', label: 'Support' },
]
</script>

<template>
  <div class="page">
    <header class="masthead">
      <h1 class="masthead__title">Bench Store</h1>
      <p class="masthead__tagline">{{ products.length }} products in this catalogue</p>
      <nav class="nav">
        <ul class="nav__list">
          <li v-for="item in nav" :key="item.href" class="nav__item">
            <a class="nav__link" :href="item.href">{{ item.label }}</a>
          </li>
        </ul>
      </nav>
    </header>
    <main class="grid">
      <ProductCard v-for="product in products" :key="product.id" :product="product" />
    </main>
  </div>
</template>

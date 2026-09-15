<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ amount: number; currency: string; discounted?: boolean }>()

const formatted = computed(() => `${(props.amount / 100).toFixed(2)} ${props.currency}`)
const original = computed(() => `${((props.amount * 1.25) / 100).toFixed(2)} ${props.currency}`)
</script>

<template>
  <p class="price">
    <span class="price__current">{{ formatted }}</span>
    <s v-if="discounted" class="price__original">{{ original }}</s>
  </p>
</template>

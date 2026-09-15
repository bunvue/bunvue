<template>
  <h2>Todo List</h2>
  <ul>
    <li v-for="(item, i) in todoList" :key="`item-${i}`">{{ item }}</li>
  </ul>
  <p>Path: {{ ctx.url.pathname }}</p>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

useHead({ title: 'Todo List' })

const ctx = useRouteContext()

// Stands in for a real data fetch
await new Promise((resolve) => setTimeout(resolve, 1))

const todoList = (ctx.state?.todoList ?? []) as string[]
</script>

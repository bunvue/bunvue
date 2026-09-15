import { createSSRApp } from 'vue'
import type { App } from 'vue'
import ProductList from './ProductList.vue'
import ProductListWithHead from './ProductListWithHead.vue'
import { products } from './products'
import type { Product } from './products'

export { products, createProducts } from './products'
export type { Product } from './products'

// Plain variant: no unhead anywhere in the tree.
export function createTree(list: Product[] = products): App {
  return createSSRApp(ProductList, { products: list })
}

type CreateHead = (typeof import('@unhead/vue/server'))['createHead']
let createHead: CreateHead | null = null

// Loads @unhead/vue/server lazily so the plain variant never pulls unhead in.
// Call once at server startup, before createTreeWithHead.
export async function initHead(): Promise<void> {
  if (!createHead) createHead = (await import('@unhead/vue/server')).createHead
}

// Head variant: same tree wrapped in a component that calls useHead.
export function createTreeWithHead(list: Product[] = products) {
  if (!createHead) throw new Error('call initHead() before createTreeWithHead()')
  const app = createSSRApp(ProductListWithHead, { products: list })
  const head = createHead()
  app.use(head)
  return { app, head }
}

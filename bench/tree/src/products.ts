export interface Product {
  id: number
  name: string
  slug: string
  price: number
  currency: string
  rating: number
  badge: string | null
  thumbnail: string
  inStock: boolean
}

const ADJECTIVES = ['Alpine', 'Coastal', 'Urban', 'Nordic', 'Desert', 'Harbor', 'Meadow', 'Summit']
const NOUNS = ['Jacket', 'Runner', 'Backpack', 'Hoodie', 'Cap', 'Glove', 'Boot', 'Vest']
const BADGES: (string | null)[] = ['New', 'Sale', null, 'Limited', null]
const CURRENCIES = ['SEK', 'EUR', 'USD']

// Deterministic: no randomness, values are pure functions of the index.
export function createProducts(count = 50): Product[] {
  const out: Product[] = []
  for (let i = 0; i < count; i++) {
    const adjective = ADJECTIVES[i % ADJECTIVES.length]
    const noun = NOUNS[(i * 3) % NOUNS.length]
    const name = `${adjective} ${noun} ${100 + i}`
    const slug = `${adjective}-${noun}-${100 + i}`.toLowerCase()
    out.push({
      id: i + 1,
      name,
      slug,
      price: 4900 + i * 137,
      currency: CURRENCIES[i % CURRENCIES.length],
      rating: (i % 5) + 1,
      badge: BADGES[i % BADGES.length],
      thumbnail: `https://cdn.example.com/img/${slug}-160.webp`,
      inStock: i % 7 !== 0,
    })
  }
  return out
}

export const products: Product[] = createProducts(50)

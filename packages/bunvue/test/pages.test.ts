import { describe, expect, it } from 'bun:test'
import { injectDefaultExport, needsDefaultExport } from '../src/plugin/pages.ts'

const named = `<template><p>hi</p></template>

<script lang="ts">
export const serverOnly = true
</script>
`

describe('page default export injection', () => {
  it('detects a script block with only named exports', () => {
    expect(needsDefaultExport(named)).toBe(true)
  })

  it('leaves a page with a script setup block alone', () => {
    expect(
      needsDefaultExport(`<script lang="ts">export const clientOnly = true</script>
<script setup lang="ts">const a = 1</script>`),
    ).toBe(false)
  })

  it('leaves a template-only page alone', () => {
    expect(needsDefaultExport('<template><p>hi</p></template>')).toBe(false)
  })

  it('leaves an existing default export alone', () => {
    expect(needsDefaultExport('<script>export default {}</script>')).toBe(false)
    expect(needsDefaultExport("<script>export { default } from './x.vue'</script>")).toBe(false)
  })

  it('injects the empty default without moving any line', () => {
    const out = injectDefaultExport(named)
    expect(out).toContain('export default {}')
    expect(out.split('\n').length).toBe(named.split('\n').length)
    expect(out).toContain('export const serverOnly = true')
  })
})

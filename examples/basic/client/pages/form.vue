<template>
  <h1>Newsletter</h1>
  <div
    v-if="sent"
    class="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
  >
    <p id="sent">Thanks, you are subscribed.</p>
  </div>
  <form method="post" class="flex max-w-sm flex-col gap-4">
    <label class="flex flex-col gap-1.5">
      Email
      <input name="email" type="email" :value="values.email ?? ''" />
    </label>
    <p v-if="errors.email" id="email-error">{{ errors.email }}</p>
    <div>
      <button type="submit">Subscribe</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouteContext } from 'bunvue/client'

/** The shape `form.server.ts` returns for invalid input. */
interface FormResult {
  errors?: { email?: string }
  values?: { email?: string }
}

const ctx = useRouteContext()
const result = (ctx.actionData ?? {}) as FormResult
const errors = result.errors ?? {}
const values = result.values ?? {}
const sent = ctx.url.searchParams.get('sent') === '1'

useHead({ title: 'Newsletter' })
</script>

<template>
  <h1>Newsletter</h1>
  <p v-if="sent" id="sent">Thanks, you are subscribed.</p>
  <form method="post">
    <label>
      Email
      <input name="email" type="email" :value="values.email ?? ''" />
    </label>
    <p v-if="errors.email" id="email-error">{{ errors.email }}</p>
    <button type="submit">Subscribe</button>
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

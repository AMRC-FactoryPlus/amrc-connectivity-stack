<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The admin login made when a gateway is approved. The service gives
     the password once, so it stays here while the tab is open. It is
     rendered as text, and never put in the URL, storage or the console. -->
<template>
  <section v-if="secret" class="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Admin login">
    <h3 class="text-sm font-semibold">{{ title }}</h3>
    <p class="text-sm">This password will not be shown again, so make sure to make a note of it now.</p>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="w-20 shrink-0 text-sm text-slate-600">Username</span>
      <span class="min-w-0 flex-1 basis-48 select-all break-all font-mono text-base font-semibold">{{ secret.user }}</span>
      <Button variant="outline" size="sm" class="gap-2" aria-label="Copy the username" @click="copy_text(secret.user, 'Username')">
        <i class="fa-solid fa-copy"></i>Copy
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="w-20 shrink-0 text-sm text-slate-600">Password</span>
      <span class="min-w-0 flex-1 basis-48 select-all break-all font-mono text-base font-semibold"><span
          v-for="(ch, i) in chars" :key="i"
          :class="[ch.digit ? 'text-blue-700' : '', grouped && i > 0 && i % 4 === 0 ? 'ml-2' : '']">{{ ch.text }}</span></span>
      <Button variant="outline" size="sm" class="gap-2" aria-label="Copy the password" @click="copy_text(secret.password, 'Password')">
        <i class="fa-solid fa-copy"></i>Copy
      </Button>
    </div>
    <label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
      <Checkbox :model-value="secret.ack" @update:model-value="v => depot.secrets[id].ack = !!v"/>
      I have recorded this password
    </label>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { copy_text } from '@/lib/gateway-depot/copy.js'

const props = defineProps({
  id: { type: String, required: true },
  /* Name the gateway in the title, for when its page no longer does. */
  named: { type: Boolean, default: false },
})

const depot = useGatewayDepotStore()
const secret = computed(() => depot.secrets[props.id] ?? null)
const title = computed(() => props.named ? 'Admin login for ' + secret.value.name : 'Admin login for this gateway')
const chars = computed(() => [...secret.value.password].map(text => ({ text, digit: /[0-9]/.test(text) })))
/* Groups of four are easier to copy by hand. */
const grouped = computed(() => /^[A-Za-z0-9]+$/.test(secret.value.password))
</script>

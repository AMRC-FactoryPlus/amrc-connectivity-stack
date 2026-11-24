<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The admin login made when a gateway is approved. The service gives
     the password once, so it stays here until the person says they have
     recorded it. It is rendered as text, and never put in the URL,
     storage or the console. -->
<template>
  <section v-if="secret && !secret.ack" ref="panel" class="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Admin login">
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h3 class="text-sm font-semibold">{{ title }}</h3>
      <Button variant="outline" size="sm" class="gap-2" @click="depot.secrets[id].ack = true">
        <i class="fa-solid fa-check"></i>I have recorded it
      </Button>
    </div>
    <p class="text-sm">This password will not be shown again once you hide it, so make a note of it now.</p>
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
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
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

/* A password nobody has recorded yet is the one thing on the page that
 * cannot wait, so bring it into view. */
const panel = ref(null)
onMounted(() => {
  if (panel.value && secret.value && !secret.value.ack)
    panel.value.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
</script>

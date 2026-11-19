<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One tile per network port, in the order the gateway reports them.
     A tile lights up for a while when its cable or address changes, so
     a person can find a port by plugging a cable in. -->
<template>
  <div>
    <ul v-if="tiles.length" class="flex flex-wrap gap-2 sm:gap-3">
      <li v-for="t in tiles" :key="t.key"
          class="flex min-h-36 min-w-0 flex-1 basis-32 flex-col items-start gap-0.5 break-all rounded-lg border p-3 text-sm sm:max-w-64 sm:basis-40"
          :class="t.event ? 'border-amber-300 bg-amber-50' : 'border-slate-200'">
        <i class="fa-solid fa-ethernet mb-1 text-2xl" :class="t.link ? 'text-green-600' : 'text-slate-300'"></i>
        <span class="font-semibold">{{ t.name }}</span>
        <Badge v-if="t.role" variant="outline">{{ t.role }}</Badge>
        <span :class="t.link ? 'font-medium text-green-700' : 'text-slate-500'">{{ t.cable }}</span>
        <span class="font-mono text-xs">{{ t.ip }}</span>
        <span class="font-mono text-xs text-slate-500">{{ t.mac }}</span>
        <span class="min-h-4 text-xs font-medium text-amber-800" aria-live="polite">{{ t.event }}</span>
        <Button v-if="copy && t.mac" variant="outline" size="xs" class="mt-auto gap-1.5"
            :aria-label="'Copy the MAC address of ' + t.name + (t.role ? ', ' + t.role.toLowerCase() : '')"
            @click="copy_text(t.mac, 'MAC address')">
          <i class="fa-solid fa-copy"></i>Copy MAC
        </Button>
      </li>
    </ul>
    <p v-else class="text-sm text-slate-500">This gateway has not reported any network ports.</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useNow } from '@vueuse/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { copy_text } from '@/lib/gateway-depot/copy.js'
import { LINK_EVENT_MS } from '@/lib/gateway-depot/constants.js'
import { clean, link_key, link_text } from '@/lib/gateway-depot/model.js'

const props = defineProps({
  gatewayId: { type: String, required: true },
  nics: { type: Array, required: true },
  /* nic -> the role to show on its tile, or nothing. */
  role: { type: Function, default: null },
  /* Offer to copy each port's MAC address. */
  copy: { type: Boolean, default: false },
})

const depot = useGatewayDepotStore()
const now = useNow({ interval: 1000 })

const tiles = computed(() => props.nics.map((n, i) => {
  const ev = depot.linkEvents[link_key(props.gatewayId, n)]
  return {
    key: n.mac || n.name || String(i),
    name: clean(n.name) || 'Unnamed port',
    role: props.role ? props.role(n) : '',
    link: !!n.link,
    cable: link_text(n),
    ip: clean(n.ipv4) || 'No address',
    mac: clean(n.mac),
    event: ev && now.value.getTime() - ev.at < LINK_EVENT_MS ? ev.text : '',
  }
}))
</script>

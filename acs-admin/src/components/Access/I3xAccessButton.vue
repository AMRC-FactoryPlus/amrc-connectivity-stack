<!--
  - ACS Admin
  - The "Manage i3X Access" button: how many people and groups can read
  - a device or ISA-95 node through i3X, and the dialog to change it.
  - Copyright 2026 University of Sheffield AMRC
  -->

<!-- A device counts everyone who can read it, by any route. An ISA-95
     node counts only the grants on that node: the dialog shows the rest.
     The dialog mounts only while open, so a table of these buttons does
     not start the principal stores once per row. -->
<template>
  <Button variant="outline" size="sm" class="gap-2" :title="title" @click.stop="open = true">
    <i class="fa-solid fa-shield-halved text-sm"></i>
    <span>Manage i3X Access</span>
    <Badge variant="secondary" class="min-w-5 justify-center px-1.5" :aria-label="title">
      <i v-if="count === null && loading" class="fa-solid fa-circle-notch animate-spin text-[10px]"></i>
      <template v-else>{{ count ?? '?' }}</template>
    </Badge>
  </Button>
  <I3xAccessDialog v-if="open" v-model:open="open"
                   :target="target" :device="device" :via="via" :noun="noun" :name="name" :path="path"
                   :rows="rows" :loading="loading" :load-error="loadError" @changed="load"/>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { read_access } from '@/lib/access/i3x-access.js'
import I3xAccessDialog from './I3xAccessDialog.vue'

const props = defineProps({
  /* What to grant on: a device UUID or an ISA-95 node UUID. */
  target: { type: String, required: true },
  /* True for a device, false for an ISA-95 node. */
  device: { type: Boolean, default: false },
  /* ISA-95 nodes above the target, top first: { uuid, name, level }. */
  via: { type: Array, default: () => [] },
  /* What to call the target in the text, e.g. "device" or "site". */
  noun: { type: String, default: 'device' },
  /* The target's name, for the dialog title. */
  name: { type: String, default: '' },
  /* Where the target sits, e.g. "AMRC / AMRC Cymru / Machine Shop". */
  path: { type: String, default: '' },
})

const open = ref(false)
const rows = ref([])
const loading = ref(false)
const loadError = ref(null)

const count = computed(() => {
  if (loadError.value) return null
  const counted = props.device ? rows.value : rows.value.filter(r => r.reason === 'direct')
  return new Set(counted.map(r => r.grant.principal)).size
})

const title = computed(() => count.value === null
  ? 'i3X access'
  : `${count.value} ${count.value === 1 ? 'person or group' : 'people and groups'} ${props.device ? 'can read this device' : 'granted on this node'} through i3X`)

async function load () {
  loading.value = true
  try {
    await serviceClientReady()
    rows.value = await read_access(useServiceClientStore().client, {
      target: { uuid: props.target, device: props.device },
      via: props.via,
    })
    loadError.value = null
  }
  catch (err) {
    console.error('i3X read access: loading grants failed', err)
    loadError.value = err
    rows.value = []
  }
  finally {
    loading.value = false
  }
}

watch(() => [props.target, props.via.map(n => n.uuid).join()], load, { immediate: true })
</script>

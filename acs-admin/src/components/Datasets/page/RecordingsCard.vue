<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Recordings on a piece of equipment: the kiosk link and QR code,
     and every run recorded on it, newest first. -->
<template>
  <Card class="flex flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-semibold">Recordings <span class="font-normal text-slate-500">{{ runs.length }}</span></span>
      <Button size="sm" variant="outline" as-child>
        <RouterLink :to="`/kiosk/${record.uuid}`"><i class="fa-solid fa-tablet-screen-button mr-2"></i>Open kiosk</RouterLink>
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <img v-if="qr" :src="qr" alt="QR code for the kiosk" class="size-24 rounded bg-white p-1"/>
      <div v-else class="flex size-24 items-center justify-center rounded bg-white text-slate-300">
        <i class="fa-solid fa-qrcode fa-2x"></i>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <div class="text-slate-700">Scan this on a tablet next to the equipment to open its kiosk.</div>
        <div class="truncate font-mono text-xs text-slate-500" :title="url">{{ url }}</div>
        <div>
          <Button size="sm" variant="outline" :disabled="!qr" @click="print">
            <i class="fa-solid fa-print mr-2"></i>Print QR code
          </Button>
        </div>
      </div>
    </div>

    <div v-if="!runs.length" class="py-4 text-center text-sm text-slate-500">
      No recordings yet. Start one from the kiosk.
    </div>
    <div v-else class="flex flex-col">
      <RouterLink v-for="r in shown" :key="r.uuid" :to="`/datasets/${r.uuid}`"
                  class="grid grid-cols-1 gap-x-3 gap-y-0.5 rounded border-b border-slate-100 px-2 py-2 text-sm hover:bg-slate-50 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_auto]">
        <span class="truncate font-medium" :title="ds.name(r.uuid)">
          {{ ds.name(r.uuid) }}
          <span v-if="r.reference" class="ml-1 rounded border border-slate-200 px-1 text-[10px] font-normal text-slate-500">{{ r.reference }}</span>
        </span>
        <span class="text-slate-700">
          {{ fmt_window(r.from, r.to) }}
          <span v-for="t in r.tags" :key="t" class="text-xs text-slate-500"> #{{ t }}</span>
        </span>
        <span class="truncate text-slate-700"><i class="fa-solid fa-user mr-1 text-xs text-slate-400"></i>{{ r.run?.operator ?? r.created_by ?? 'Unknown' }}</span>
        <span><StatusPill :record="r"/></span>
      </RouterLink>
      <Button v-if="runs.length > limit" variant="link" size="sm" class="self-start px-0" @click="limit = Infinity">
        Show all {{ runs.length }} recordings
      </Button>
    </div>
  </Card>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import QRCode from 'qrcode'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { fmt_window } from '@/lib/datasets/model.js'
import { kiosk_url } from '@/lib/datasets/links.js'
import StatusPill from '../StatusPill.vue'

const props = defineProps({ record: { type: Object, required: true } })

const ds = useDatasetsStore()
const qr = ref(null)
const limit = ref(8)

const url = computed(() => kiosk_url(props.record.uuid))
const runs = computed(() => ds.runsByEquipment[props.record.uuid] ?? [])
const shown = computed(() => runs.value.slice(0, limit.value))

watch(url, async u => {
  try { qr.value = await QRCode.toDataURL(u, { margin: 1, width: 320 }) }
  catch (err) { console.error('Kiosk QR code failed', err); qr.value = null }
}, { immediate: true })

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// A plain page with the name and the code, printed from a new window.
function print () {
  const w = window.open('', '_blank')
  if (!w) return
  const name = escape(ds.name(props.record.uuid))
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px}h1{font-size:28px;margin:0 0 8px}
p{color:#555;margin:0 0 24px}img{width:320px;height:320px}code{font-size:11px;color:#777}</style></head>
<body><h1>${name}</h1><p>Scan to open the recording kiosk</p><img src="${qr.value}" alt=""><br><code>${escape(url.value)}</code></body></html>`)
  w.document.close()
  // Some browsers have already loaded the written document, so try
  // both, once.
  let done = false
  const go = () => { if (done || w.closed) return; done = true; w.focus(); w.print() }
  w.onload = go
  setTimeout(go, 300)
}
</script>

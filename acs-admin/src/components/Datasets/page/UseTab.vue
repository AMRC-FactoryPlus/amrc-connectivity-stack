<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Use tab: CSV, the API, Grafana and Share. -->
<template>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <Card class="flex flex-col gap-3 p-5">
      <div class="font-semibold"><i class="fa-solid fa-file-csv mr-2 text-slate-500"></i>CSV</div>
      <p class="text-sm text-slate-600">
        Every metric in the dataset, one row per reading: device, metric, timestamp, value and unit.
        Timestamps are in UTC.
      </p>
      <div>
        <Button :disabled="downloading" @click="$emit('download')">
          <i :class="['fa-solid mr-2', downloading ? 'fa-circle-notch animate-spin' : 'fa-download']"></i>Download CSV
        </Button>
      </div>
    </Card>

    <Card class="flex flex-col gap-3 p-5">
      <div class="font-semibold"><i class="fa-solid fa-chart-line mr-2 text-slate-500"></i>Grafana</div>
      <template v-if="grafana">
        <p class="text-sm text-slate-600">Opens Grafana Explore over this dataset's window. It shows all data in that window, not only this dataset's metrics.</p>
        <div>
          <Button variant="outline" as-child>
            <a :href="grafana" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square mr-2"></i>Open in Grafana</a>
          </Button>
        </div>
      </template>
      <p v-else class="text-sm text-slate-500">The Grafana address is not known from this page's address, so there is no link.</p>
    </Card>

    <Card class="flex flex-col gap-3 p-5 lg:col-span-2">
      <div class="font-semibold"><i class="fa-solid fa-code mr-2 text-slate-500"></i>API</div>
      <div class="flex flex-col gap-1">
        <div class="text-xs text-slate-500">Dataset UUID</div>
        <Copyable :text="record.uuid"><code class="font-mono text-sm">{{ record.uuid }}</code></Copyable>
      </div>
      <div class="flex flex-col gap-1">
        <div class="text-xs text-slate-500">Data endpoint</div>
        <Copyable v-if="apiUrl" :text="apiUrl"><code class="break-all font-mono text-sm">POST {{ apiUrl }}</code></Copyable>
        <div v-else-if="apiError" class="text-sm text-slate-500">{{ apiError }}</div>
        <div v-else class="text-sm text-slate-500"><i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Finding the Data Access address</div>
      </div>
      <p class="text-sm text-slate-600">
        Send a token for an account that can read this dataset in the <code class="font-mono">Authorization</code> header.
        Ask for <code class="font-mono">text/csv</code>.
      </p>
      <pre class="overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-50">{{ curl }}</pre>
    </Card>

    <ShareCard :record="record" class="lg:col-span-2"/>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Copyable from '@/components/Copyable.vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { data_api_url } from '@/lib/datasets/links.js'
import ShareCard from './ShareCard.vue'

const props = defineProps({
  record: { type: Object, required: true },
  grafana: { type: String, default: null },
  downloading: { type: Boolean, default: false },
})
defineEmits(['download'])

const apiUrl = ref(null)
const apiError = ref(null)

watch(() => props.record.uuid, async uuid => {
  apiUrl.value = null
  apiError.value = null
  try { apiUrl.value = await data_api_url(useServiceClientStore().client, uuid) }
  catch (err) {
    console.error('Data Access URL lookup failed', err)
    apiError.value = 'Could not find the Data Access address.'
  }
}, { immediate: true })

const curl = computed(() => [
  `curl -X POST \\`,
  `  -H "Authorization: Bearer <token>" \\`,
  `  -H "Accept: text/csv" \\`,
  `  -H "Content-Type: application/json" \\`,
  `  -d '{}' \\`,
  `  "${apiUrl.value ?? `<data access>/v1/data/${props.record.uuid}`}"`,
].join('\n'))
</script>

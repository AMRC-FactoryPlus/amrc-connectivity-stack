<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import { useI3xClient } from '@composables/useI3xClient.js'
import dayjs from 'dayjs'

const props = defineProps({
  elementId: { type: String, required: true },
  isComposition: { type: Boolean, default: false },
})

const i3x = useI3xClient()
const loading = ref(false)
const error = ref(null)
const data = ref(null)

async function fetchValue () {
  loading.value = true
  error.value = null
  try {
    data.value = await i3x.getValue(props.elementId)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.elementId, () => {
  data.value = null
  fetchValue()
}, { immediate: true })

function formatTimestamp (ts) {
  if (!ts) return '-'
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

function formatValue (val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">Current Value</CardTitle>
        <Button variant="ghost" size="sm" @click="fetchValue" :disabled="loading">
          <i class="fa-solid fa-rotate-right" :class="{ 'fa-spin': loading }"></i>
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
      <div v-else-if="loading && !data" class="text-sm text-slate-400">Loading...</div>
      <div v-else-if="data">
        <div v-if="!data.isComposition" class="flex items-center gap-3">
          <span class="text-2xl font-semibold font-mono">{{ formatValue(data.value) }}</span>
          <QualityBadge :quality="data.quality" />
          <span class="text-xs text-slate-400 ml-auto">{{ formatTimestamp(data.timestamp) }}</span>
        </div>

        <div v-else>
          <p class="text-sm text-slate-500 mb-3">Composition with {{ Object.keys(data.components || {}).length }} components</p>
          <div class="border rounded-md overflow-hidden" v-if="data.components">
            <table class="w-full text-sm">
              <thead class="bg-slate-50">
                <tr>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Component</th>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Value</th>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Quality</th>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(vqt, key) in data.components" :key="key" class="border-t">
                  <td class="px-3 py-1.5 font-mono text-xs truncate max-w-[200px]">{{ key }}</td>
                  <td class="px-3 py-1.5 font-mono">{{ formatValue(vqt.value) }}</td>
                  <td class="px-3 py-1.5"><QualityBadge :quality="vqt.quality" /></td>
                  <td class="px-3 py-1.5 text-xs text-slate-400">{{ formatTimestamp(vqt.timestamp) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-slate-400">No value available</div>
    </CardContent>
  </Card>
</template>

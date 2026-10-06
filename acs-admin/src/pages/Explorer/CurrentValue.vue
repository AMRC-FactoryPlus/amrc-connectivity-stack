<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import ValueTreeRow from './ValueTreeRow.vue'
import { useI3xClient } from '@composables/useI3xClient.js'
import { mk_node, load_subtree, count_leaves } from '@/lib/explorer/value-tree.js'
import dayjs from 'dayjs'

const props = defineProps({
  elementId: { type: String, required: true },
  isComposition: { type: Boolean, default: false },
})

const i3x = useI3xClient()
const loading = ref(false)
const error = ref(null)
const leafValue = ref(null)
// The selected composition, as { elementId, displayName, isComposition,
// children, vqt }. `children` is null until that level is read.
const root = ref(null)
const collapsed = reactive(new Set())
const loadingIds = reactive(new Set())

// Bumped on every fetch, so a slow answer for an earlier selection
// does not replace the current one.
let generation = 0

async function fetchValue () {
  const mine = ++generation
  loading.value = true
  error.value = null
  try {
    if (props.isComposition) {
      const top = mk_node({ elementId: props.elementId, isComposition: true })
      await load_subtree(i3x, top)
      if (mine !== generation) return
      leafValue.value = null
      root.value = top
    } else {
      const value = await i3x.getValue(props.elementId)
      if (mine !== generation) return
      leafValue.value = value
      root.value = null
    }
  } catch (e) {
    if (mine === generation) error.value = e.message
  } finally {
    if (mine === generation) loading.value = false
  }
}

async function toggle (node) {
  if (loadingIds.has(node.elementId)) return
  if (node.children === null) {
    loadingIds.add(node.elementId)
    try {
      // Read into a copy, so the rows appear with their values.
      const loaded = mk_node(node)
      await load_subtree(i3x, loaded)
      node.children = loaded.children
      collapsed.delete(node.elementId)
    } catch (e) {
      error.value = e.message
    } finally {
      loadingIds.delete(node.elementId)
    }
    return
  }
  if (collapsed.has(node.elementId)) collapsed.delete(node.elementId)
  else collapsed.add(node.elementId)
}

watch(() => [props.elementId, props.isComposition], () => {
  leafValue.value = null
  root.value = null
  collapsed.clear()
  fetchValue()
}, { immediate: true })

const summary = computed(() => root.value
  ? count_leaves(root.value)
  : { leaves: 0, reported: 0 })

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
      <div v-else-if="loading && !leafValue && !root" class="text-sm text-slate-400">Loading...</div>

      <div v-else-if="leafValue && !leafValue.isComposition" class="flex items-center gap-3">
        <span class="text-2xl font-semibold font-mono">{{ formatValue(leafValue.value) }}</span>
        <QualityBadge :quality="leafValue.quality" />
        <span class="text-xs text-slate-400 ml-auto">{{ formatTimestamp(leafValue.timestamp) }}</span>
      </div>

      <div v-else-if="root?.children?.length">
        <p class="text-sm text-slate-500 mb-3">
          {{ summary.leaves }} values<template v-if="summary.leaves > summary.reported">, {{ summary.leaves - summary.reported }} not reported</template>
        </p>
        <div class="border rounded-md overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50">
              <tr>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Name</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Value</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Quality</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <ValueTreeRow
                v-for="child in root.children"
                :key="child.elementId"
                :node="child"
                :depth="0"
                :collapsed="collapsed"
                :loading-ids="loadingIds"
                @toggle="toggle"
              />
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="text-sm text-slate-400">No value available</div>
    </CardContent>
  </Card>
</template>

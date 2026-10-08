<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Add-ons card in the Overview side column: one line for energy
     and carbon, or a note that no add-ons apply. -->
<template>
  <Card class="flex flex-col gap-2.5 p-4">
    <div class="flex items-center justify-between">
      <span class="font-semibold">Add-ons</span>
      <Button variant="link" size="sm" class="h-auto p-0" @click="$emit('open')">Open</Button>
    </div>

    <div v-if="!applies" class="text-sm text-slate-500">
      No add-ons apply to this data yet. They appear when a dataset contains the metrics they need.
    </div>
    <template v-else>
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium"><i class="fa-solid fa-bolt mr-1 text-xs text-slate-500"></i>Energy and carbon</span>
        <span v-if="state === 'ready' && r" class="text-xs text-green-600"><i class="fa-solid fa-circle-check mr-1"></i>Calculated</span>
        <span v-else-if="state === 'loading'" class="text-xs text-slate-500"><i class="fa-solid fa-circle-notch animate-spin mr-1"></i>Calculating</span>
        <span v-else-if="state === 'error'" class="text-xs text-red-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Failed</span>
      </div>
      <div v-if="state === 'ready' && r" class="grid grid-cols-2 gap-2">
        <div>
          <div class="text-xl font-semibold tabular-nums">{{ one(r.kwh) }}</div>
          <div class="text-xs text-slate-500">kWh</div>
        </div>
        <div>
          <div class="text-xl font-semibold tabular-nums">{{ one(r.kg_grid ?? r.kg_fixed) }}</div>
          <div class="text-xs text-slate-500">kgCO2e, {{ r.kg_grid != null ? 'grid intensity' : 'fixed factor' }}</div>
        </div>
      </div>
      <div v-else-if="state === 'empty'" class="text-sm text-slate-500">No energy register found in the data.</div>
      <div v-else-if="state === 'idle'" class="text-sm text-slate-600">Applies. Not calculated yet.</div>
      <div v-if="state === 'ready' || state === 'idle'" class="text-xs text-slate-400">Calculated in your browser, not saved.</div>
    </template>
  </Card>
</template>

<script setup>
import { computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fmt_amount } from './energy-logic.js'

const props = defineProps({ ec: { type: Object, required: true } })
defineEmits(['open'])

const applies = computed(() => ['applies', 'unknown'].includes(props.ec.applies.value.state))
const state = computed(() => props.ec.state.value)
const r = computed(() => props.ec.result.value)
const one = fmt_amount
</script>

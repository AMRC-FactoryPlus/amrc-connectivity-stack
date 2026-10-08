<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <span class="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
    <i :class="`fa-solid fa-fw fa-${info.icon} text-slate-500`"></i>
    <span>{{ info.label }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { kind_info } from '@/lib/datasets/constants.js'

const props = defineProps({ kind: { type: String, default: 'other' } })
const info = computed(() => kind_info(props.kind))
</script>

<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'

const props = defineProps({
  quality: {
    type: String,
    default: null,
    validator: v => [null, 'Good', 'GoodNoData', 'Bad', 'Uncertain'].includes(v),
  },
})

const config = computed(() => {
  switch (props.quality) {
    case 'Good':
      return { label: 'Good', class: 'bg-green-500 text-white border-green-500' }
    case 'Uncertain':
      return { label: 'Uncertain', class: 'bg-yellow-500 text-white border-yellow-500' }
    case 'GoodNoData':
      return { label: 'No Data', class: 'bg-slate-400 text-white border-slate-400' }
    case 'Bad':
      return { label: 'Bad', class: 'bg-red-500 text-white border-red-500' }
    default:
      return { label: 'Unknown', class: 'bg-slate-300 text-slate-600 border-slate-300' }
  }
})
</script>

<template>
  <Badge :class="config.class" class="text-[10px] px-1.5 py-0">
    {{ config.label }}
  </Badge>
</template>

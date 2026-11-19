<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A gateway's state as a pill. `tone` is action (waiting for a
     person), busy, ok, bad or off. -->
<template>
  <Badge variant="outline" class="gap-1.5 whitespace-nowrap uppercase tracking-wide" :class="TONES[tone] ?? TONES.off">
    <i v-if="tone === 'busy'" class="fa-solid fa-circle-notch animate-spin motion-reduce:animate-none"></i>
    <i v-else-if="tone === 'bad'" class="fa-solid fa-triangle-exclamation"></i>
    <span v-else class="size-2 rounded-full" :class="DOTS[tone] ?? DOTS.off"></span>
    <span>{{ label }}</span>
  </Badge>
</template>

<script setup>
import { Badge } from '@/components/ui/badge'

defineProps({
  label: { type: String, required: true },
  tone: { type: String, default: 'off' },
})

const TONES = {
  action: 'border-amber-400 bg-amber-50 text-amber-800',
  busy: 'border-slate-300 bg-slate-100 text-slate-700',
  ok: 'border-green-600 bg-green-50 text-green-700',
  bad: 'border-red-300 bg-red-50 text-red-600',
  off: 'border-slate-300 bg-white text-slate-600',
}
const DOTS = {
  action: 'bg-amber-500',
  ok: 'bg-green-500',
  off: 'border-2 border-slate-400',
}
</script>

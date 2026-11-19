<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One of a gateway's five steps: its number on a rail, its title,
     where it stands, and whatever the step needs underneath. -->
<template>
  <li class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 sm:gap-x-4" :aria-current="active ? 'step' : null">
    <div class="flex flex-col items-center">
      <span class="flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold" :class="NUM[step.status]" aria-hidden="true">
        <i v-if="step.status === 'done'" class="fa-solid fa-check"></i>
        <i v-else-if="step.status === 'failed'" class="fa-solid fa-xmark"></i>
        <template v-else>{{ step.n }}</template>
      </span>
      <span v-if="!last" class="min-h-2 w-0.5 flex-1" :class="step.status === 'done' ? 'bg-green-600' : 'bg-slate-200'" aria-hidden="true"></span>
    </div>
    <div class="flex min-w-0 flex-col" :class="[last ? '' : 'pb-6', active ? 'gap-4' : 'gap-1']">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 class="text-base font-semibold leading-7" :class="TITLE[step.status]">
          <span class="sr-only">Step {{ step.n }} of 5: </span>{{ step.title }}<span
              v-if="step.tag" class="font-normal" :class="step.status === 'failed' ? 'text-red-600' : 'text-slate-500'"> · {{ step.tag }}</span>
        </h2>
        <time v-if="step.at" class="text-xs text-slate-500" :datetime="new Date(step.at).toISOString()" :title="new Date(step.at).toLocaleString()">{{ clock(step.at) }}</time>
      </div>
      <p v-if="step.status === 'todo'" class="text-sm text-slate-500">{{ step.hint }}</p>
      <slot v-else></slot>
    </div>
  </li>
</template>

<script setup>
import { computed } from 'vue'
import { clock } from '@/lib/gateway-depot/model.js'

const props = defineProps({
  /* One entry of steps_of(). */
  step: { type: Object, required: true },
  last: { type: Boolean, default: false },
})

const active = computed(() => props.step.status === 'current' || props.step.status === 'failed')

const NUM = {
  done: 'border-green-600 bg-green-600 text-white',
  current: 'border-slate-900 bg-slate-900 text-slate-50',
  failed: 'border-red-600 bg-red-600 text-white',
  todo: 'border-slate-300 bg-white text-slate-500',
}
const TITLE = {
  done: 'text-slate-500',
  current: '',
  failed: 'text-red-600',
  todo: 'text-slate-500',
}
</script>

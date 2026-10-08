<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The timeline toolbar: quick jumps, the date popover, arrows, zoom
     and search on the left; the page's own actions (the #actions slot)
     on the right. It only emits; the timeline (or the Data tab charts)
     moves the view. -->
<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" @click="emit('go', quick.today)">Today</Button>
      <Button variant="outline" size="sm" @click="emit('go', quick.yesterday)">Yesterday</Button>
      <Button variant="ghost" size="icon" :title="`Back ${stepLabel}`" @click="emit('step', -1)">
        <i class="fa-solid fa-chevron-left"></i>
        <span class="sr-only">Back {{ stepLabel }}</span>
      </Button>
      <Popover v-model:open="dateOpen">
        <PopoverTrigger as-child>
          <Button variant="ghost" class="min-w-[180px] gap-2 font-medium" title="Pick a date">
            <i class="fa-solid fa-calendar text-xs text-slate-500"></i>
            <span>{{ label }}</span>
            <i class="fa-solid fa-chevron-down text-[9px] text-slate-500"></i>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="flex w-[260px] flex-col gap-2.5 p-3">
          <label class="text-xs text-slate-500" for="timeline-go-to-date">Go to date</label>
          <input id="timeline-go-to-date" type="date" :value="dateValue"
                 class="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                 @change="onDate">
          <div class="flex flex-col gap-0.5 border-t border-slate-100 pt-1.5">
            <button v-for="q in quickItems" :key="q.label" type="button"
                    class="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none"
                    @click="pick(q.t)">
              {{ q.label }}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" :title="`Forward ${stepLabel}`" @click="emit('step', 1)">
        <i class="fa-solid fa-chevron-right"></i>
        <span class="sr-only">Forward {{ stepLabel }}</span>
      </Button>
      <Tabs :model-value="zoom" @update:model-value="z => emit('zoom', z)">
        <TabsList>
          <TabsTrigger v-for="(z, id) in ZOOMS" :key="id" :value="id">{{ z.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <div v-if="searchable || $slots.actions" class="flex flex-wrap items-center gap-2">
      <div v-if="searchable" class="relative w-[220px]">
        <i class="fa-solid fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400"></i>
        <input :value="search" type="search" placeholder="Equipment or devices..." aria-label="Search equipment or devices"
               class="flex h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
               @input="e => emit('update:search', e.target.value)">
      </div>
      <slot name="actions"/>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ZOOMS } from '@/lib/datasets/model.js'
import { quick_dates, date_input_to_ms } from '@/lib/datasets/timeline.js'

const props = defineProps({
  zoom: { type: String, required: true },
  label: { type: String, required: true },
  // "YYYY-MM-DD" of the centre of the view, for the date input.
  dateValue: { type: String, default: '' },
  search: { type: String, default: '' },
  now: { type: Number, required: true },
  // Show the search box (the timeline does; the Data tab charts do not).
  searchable: { type: Boolean, default: true },
  // What the arrows move by, when not the zoom's own step.
  stepText: { type: String, default: null },
})
const emit = defineEmits(['go', 'step', 'zoom', 'update:search'])

const dateOpen = ref(false)
const quick = computed(() => quick_dates(props.now))

const STEP_LABELS = { hours: 'a day', days: 'a week', weeks: '4 weeks', years: '3 months' }
const stepLabel = computed(() => props.stepText ?? STEP_LABELS[props.zoom] ?? '')

const quickItems = computed(() => [
  { label: 'Today', t: quick.value.today },
  { label: 'Yesterday', t: quick.value.yesterday },
  { label: 'A week ago', t: quick.value.week_ago },
  { label: 'A month ago', t: quick.value.month_ago },
  { label: 'Start of the year', t: quick.value.year_start },
])

function pick (t) {
  dateOpen.value = false
  emit('go', t)
}

function onDate (e) {
  const t = date_input_to_ms(e.target.value)
  if (!Number.isNaN(t)) pick(t)
}
</script>

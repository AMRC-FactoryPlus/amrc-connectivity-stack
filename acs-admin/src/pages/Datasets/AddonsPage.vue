<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Add-ons page: what each add-on needs, what else it uses, what
     it gives and when it runs, how many datasets it applies to, and what
     reference windows are. -->
<template>
  <div class="flex max-w-[1000px] flex-col gap-5">
    <div>
      <RouterLink to="/datasets?view=list" class="inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <i class="fa-solid fa-arrow-left text-[11px]"></i>Back
      </RouterLink>
      <h1 class="mt-2 text-2xl font-semibold leading-[30px] tracking-tight text-gray-900">Add-ons</h1>
      <p class="mt-2 max-w-[760px] text-slate-700">
        An add-on works something out from a dataset's data. It looks at which metrics a dataset holds and,
        if it can use them, adds a section to the dataset's Add-ons tab. Add-ons never change a dataset.
        Results are worked out in your browser and are not saved.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4">
      <Card v-for="a in list" :key="a.id" class="grid grid-cols-1 gap-6 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div class="text-base font-semibold">
            <i :class="`fa-solid fa-${a.icon} fa-fw text-slate-500`"></i> {{ a.name }}
          </div>
          <div class="mt-1 text-xs font-medium" :class="a.available ? 'text-green-600' : 'text-slate-500'">
            {{ a.available ? 'Available' : 'Coming later' }}
          </div>
          <div class="text-xs text-gray-500">{{ a.applies }}</div>
        </div>
        <dl class="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt class="text-gray-500">Needs</dt><dd>{{ a.needs }}</dd>
          <dt class="text-gray-500">Also uses</dt><dd>{{ a.uses }}</dd>
          <dt class="text-gray-500">Gives</dt><dd>{{ a.gives }}</dd>
          <dt class="text-gray-500">Runs</dt><dd>{{ a.runs }}</dd>
        </dl>
      </Card>
    </div>

    <Card class="flex flex-col gap-2 p-5">
      <div class="font-semibold">Reference windows</div>
      <p class="text-sm text-slate-700">
        A reference window is a short recording of equipment in a known state: Idle, Warm-up, Calibration or Other.
        Record one from the kiosk or from the equipment's page. Add-ons do not use reference windows yet,
        so energy and carbon totals include the equipment's baseload.
      </p>
    </Card>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { Card } from '@/components/ui/card'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { ADDONS, addon_applies_count, applies_text } from '@/lib/datasets/addons.js'

const ds = useDatasetsStore()

const devicesOf = r => ds.devicesOf(r.uuid).devices.map(d => ds.deviceByUuid[d]).filter(Boolean)

const list = computed(() => ADDONS.map(a => ({
  ...a,
  applies: !a.available ? applies_text(a, 0) : ds.ready && ds.devicesReady ? applies_text(a, addon_applies_count(a.id, ds.visible, devicesOf)) : 'Counting datasets',
})))

onMounted(() => ds.start())
onUnmounted(() => ds.stop())
</script>

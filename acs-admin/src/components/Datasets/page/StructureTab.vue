<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Structure tab: what the dataset is built from, in plain words,
     with the service's types and UUIDs behind a switch. Then what
     includes it, and how deleting works. -->
<template>
  <div class="flex flex-col gap-4">
    <Card class="flex flex-col">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <span class="font-semibold">Built from</span>
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Switch v-model="showIds"/>Show types and UUIDs
        </label>
      </div>
      <div v-if="!record.structure" class="px-4 py-6 text-center text-sm text-slate-500">
        Structure is visible to people who can edit this dataset.
      </div>
      <div v-else class="flex flex-col py-2">
        <div v-for="(row, i) in rows" :key="`${row.uuid}-${i}`"
             class="flex items-center gap-3 py-1.5 pr-4 text-sm hover:bg-slate-50"
             :style="{ paddingLeft: `${8 + 24 * row.depth + 8}px` }">
          <i :class="['fa-solid fa-fw text-xs', icon(row)]"></i>
          <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <RouterLink v-if="row.name && row.depth > 0" :to="`/datasets/${row.uuid}`" class="truncate font-medium hover:underline">{{ row.name }}</RouterLink>
            <span v-else class="truncate font-medium">{{ row.name ?? (row.unknown ? 'Unknown' : 'Unnamed') }}</span>
            <span :class="row.cycle || row.invalid ? 'text-red-600' : row.unknown ? 'text-amber-700' : 'text-slate-500'">{{ row.wording }}</span>
            <span v-if="row.label" class="rounded border border-slate-200 px-1.5 text-xs font-medium">labelled {{ row.label }}</span>
          </div>
          <div v-if="showIds" class="hidden shrink-0 text-right text-xs text-slate-500 md:block">
            <div>{{ structure_type(row.structure) }}</div>
            <div class="font-mono">{{ row.uuid }}</div>
          </div>
        </div>
      </div>
    </Card>

    <IncludedIn :record="record"/>

    <Card class="flex flex-wrap items-center justify-between gap-4 p-5">
      <div class="max-w-prose text-sm">
        <div class="font-semibold text-gray-900">Delete this dataset</div>
        <p class="mt-1 text-slate-600">
          Deleting removes the definition only. The data stays in the historian.
          The service refuses while other datasets include this one, and then lists them,
          including any you cannot see here.
        </p>
      </div>
      <Button variant="destructive" @click="$emit('delete')"><i class="fa-solid fa-trash mr-2"></i>Delete</Button>
    </Card>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { STRUCTURE } from '@/lib/datasets/constants.js'
import { structure_tree } from '@/lib/datasets/model.js'
import { tree_rows, structure_type } from './page-logic.js'
import IncludedIn from './IncludedIn.vue'

const props = defineProps({ record: { type: Object, required: true } })
defineEmits(['delete'])

const ds = useDatasetsStore()
const showIds = ref(false)

const rows = computed(() => tree_rows(structure_tree(props.record.uuid, ds.byUuid), {
  deviceName: u => ds.deviceByUuid[u]?.name ?? null,
}))

function icon (row) {
  if (row.cycle) return 'fa-rotate text-red-500'
  if (row.invalid) return 'fa-triangle-exclamation text-red-500'
  if (row.unknown) return 'fa-eye-slash text-amber-600'
  if (row.structure === STRUCTURE.DEVICE) return 'fa-microchip text-slate-500'
  if (row.structure === STRUCTURE.UNION) return 'fa-layer-group text-slate-500'
  if (row.structure === STRUCTURE.SESSION) return 'fa-clock text-slate-500'
  return 'fa-database text-slate-500'
}
</script>

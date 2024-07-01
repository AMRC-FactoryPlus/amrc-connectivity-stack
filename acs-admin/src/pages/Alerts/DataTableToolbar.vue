<script setup lang="ts">
import type { Table } from '@tanstack/vue-table'
import { computed } from 'vue'
import type { Alert } from './columns'

import DataTableFacetedFilter from './DataTableFacetedFilter.vue'
import DataTableViewOptions from './DataTableViewOptions.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAlertsStore } from '@/store/useAlertsStore.js'


interface DataTableToolbarProps {
  table: Table<Alert>
}

const props = defineProps<DataTableToolbarProps>()

const isFiltered = computed(() => props.table.getState().columnFilters.length > 0)

const a = useAlertsStore();

// Define a computed property that gets all unique types keys from a.alerts
const types = computed(() => {
  const types = new Set<{ label: string; value: string; }>()
  a.alerts.forEach((a) => types.add({
      label: a.type,
      value: a.type,
  }))
  return Array.from(types)
})

// Define a computed property that gets all unique devices keys from a.alerts
const devices = computed(() => {
    const devices = new Set<{ label: string; value: string; }>()
    a.alerts.forEach((a) => devices.add({
        label: a.device,
        value: a.device,
    }))
    return Array.from(devices)
})

</script>

<template>
  <div class="flex items-center justify-between">
    <div class="flex flex-1 items-center space-x-2">

      <DataTableFacetedFilter
        v-if="table.getColumn('type')"
        :column="table.getColumn('type')"
        title="Alert Type"
        :options="types"
      />

      <DataTableFacetedFilter
          v-if="table.getColumn('device')"
          :column="table.getColumn('device')"
          title="Device"
          :options="devices"
      />

      <Button
        v-if="isFiltered"
        variant="ghost"
        class="h-8 px-2 lg:px-3 gap-1.5 flex items-center justify-center"
        @click="table.resetColumnFilters()"
      >
        Reset
        <i class="fa-solid fa-times"></i>
      </Button>
    </div>
    <DataTableViewOptions :table="table" />
  </div>
</template>

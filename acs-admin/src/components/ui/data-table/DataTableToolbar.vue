<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup lang="ts">
import type {Table} from '@tanstack/vue-table'
import {computed} from 'vue'
import type {Alert} from './columns'

import DataTableFacetedFilter from './DataTableFacetedFilter.vue'
import DataTableViewOptions from './DataTableViewOptions.vue'
import {Button} from '@/components/ui/button'
import {useAlertStore} from '@/store/useAlertStore.js'


interface DataTableToolbarProps {
    filters: { name: string; property: string, options: Array<any> }[],
    table: Table<Alert>
}

const props = defineProps<DataTableToolbarProps>()

const isFiltered = computed(() => props.table.getState().columnFilters.length > 0)

const a = useAlertStore();

</script>

<template>
  <div class="flex items-center justify-between">
    <div class="flex flex-1 items-center space-x-2">
      <slot name="left"/>
      <DataTableFacetedFilter
          v-for="filter in filters"
          :key="filter.property"
          :column="table.getColumn(filter.property)"
          :title="filter.name"
          :options="filter.options"
      />

      <Button
          v-if="isFiltered"
          variant="ghost"
          size="sm"
          class="gap-1.5 flex items-center justify-center"
          @click="table.resetColumnFilters()"
      >
        Reset
        <i class="fa-solid fa-times"></i>
      </Button>
    </div>
    <div class="flex items-center justify-center gap-2">
      <DataTableViewOptions :table="table"/>
      <slot name="right"/>
    </div>
  </div>
</template>

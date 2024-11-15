<!--
  - Copyright (c) University of Sheffield AMRC 2024.
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
          class="h-8 px-2 lg:px-3 gap-1.5 flex items-center justify-center"
          @click="table.resetColumnFilters()"
      >
        Reset
        <i class="fa-solid fa-times"></i>
      </Button>
    </div>
    <DataTableViewOptions :table="table"/>
  </div>
</template>

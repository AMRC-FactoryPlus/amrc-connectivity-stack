<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup lang="ts">
import type {ColumnDef, ColumnFiltersState, SortingState, VisibilityState,} from '@tanstack/vue-table'
import {
    FlexRender,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getFilteredRowModel,
    getSortedRowModel,
    useVueTable,
} from '@tanstack/vue-table'

import {ref} from 'vue'
// import DataTablePagination from './DataTablePagination.vue'
import DataTableToolbar from './DataTableToolbar.vue'
import {valueUpdater} from '@/lib/utils'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from '@/components/ui/table'
import {useLayoutStore} from '@/store/layoutStore.js'

interface DataTableProps<T> {
    columns: ColumnDef<T, any>[]
    data: T[],
    filters: { name: string; property: string }[]
    defaultSort?: SortingState,
    empty?: string
}

const props = defineProps<DataTableProps<any>>()

const sorting = ref<SortingState>(props.defaultSort || [])
const columnFilters = ref<ColumnFiltersState>([])
const columnVisibility = ref<VisibilityState>({})
const rowSelection = ref({})



const l =  useLayoutStore();

const table = useVueTable({
    get data() {
        return props.data
    },
    get columns() {
        return props.columns
    },
    state: {
        get sorting() {
            return sorting.value
        },
        get columnFilters() {
            return columnFilters.value
        },
        get columnVisibility() {
            return columnVisibility.value
        },
        get rowSelection() {
            return rowSelection.value
        },
    },
    enableRowSelection: true,
    onSortingChange: updaterOrValue => valueUpdater(updaterOrValue, sorting),
    onColumnFiltersChange: updaterOrValue => valueUpdater(updaterOrValue, columnFilters),
    onColumnVisibilityChange: updaterOrValue => valueUpdater(updaterOrValue, columnVisibility),
    onRowSelectionChange: updaterOrValue => valueUpdater(updaterOrValue, rowSelection),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
})
</script>

<template>
  <div class="space-y-2">
    <DataTableToolbar v-if="!l.fullscreen" :filters="filters" :table="table">
      <template #left>
        <slot name="toolbar-left" :table="table"></slot>
      </template>
      <template #right>
        <slot name="toolbar-right" :table="table"></slot>
      </template>
    </DataTableToolbar>
    <slot name="below-toolbar"></slot>
    <div class="rounded-md border">
      <slot v-if="table.getRowModel().rows?.length === 0 && $slots.empty" name="empty"></slot>
      <Table v-else>
        <TableHeader>
          <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <TableHead v-for="header in headerGroup.headers" :key="header.id">
              <FlexRender v-if="!header.isPlaceholder"
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"/>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="table.getRowModel().rows?.length">
            <TableRow
                v-for="row in table.getRowModel().rows"
                :key="row.id"
                :data-state="row.getIsSelected() && 'selected'"
                class="cursor-pointer"
                @click="$emit('row-click', row)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()"/>
              </TableCell>
            </TableRow>
          </template>

          <TableRow v-else>
            <TableCell
                :colspan="table.getVisibleLeafColumns().length"
                class="h-24 text-center"
            >
              {{ empty ?? 'No data' }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

<!--    <DataTablePagination v-if="!l.fullscreen" :table="table"/>-->
  </div>
</template>

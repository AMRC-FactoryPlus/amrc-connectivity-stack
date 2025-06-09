<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup lang="ts">
import type {ColumnDef, ColumnFiltersState, ExpandedState, SortingState, VisibilityState,} from '@tanstack/vue-table'
import {FlexRender, getCoreRowModel, getExpandedRowModel, getFilteredRowModel, getSortedRowModel, useVueTable,} from '@tanstack/vue-table'
import {Input} from '@/components/ui/input'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from '@/components/ui/table'
import {valueUpdater} from '@/lib/utils'
import {ref} from 'vue'
import DataTableToolbar from "@components/ui/data-table/DataTableToolbar.vue";

interface DataTableProps<T> {
    columns: ColumnDef<T, any>[]
    data: T[],
    searchKey?: string,
    limitHeight: boolean,
    filters: { name: string; property: string }[]
    defaultSort?: SortingState,
    selectedObjects: [],
    empty?: string,
    clickable?: boolean,
}

const props = defineProps<DataTableProps<any>>()

const sorting = ref<SortingState>(props.defaultSort || [])
const columnFilters = ref<ColumnFiltersState>([])
const columnVisibility = ref<VisibilityState>({})
const rowSelection = ref({})
const expanded = ref<ExpandedState>({})

// Write a method to toggle the expanded state of a row
const toggle = (row: any) => {
    row.toggleSelected()
}

const emit = defineEmits(['row-click'])

const rowClick = function(row: any) {
    if (props.clickable) {
        emit('row-click', row)
    } else {
        toggle(row)
    }
}

const table = useVueTable({
    get data() {
        return props.data
    },
    get columns() {
        return props.columns
    },
    getCoreRowModel: getCoreRowModel(),
    // getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    onSortingChange: updaterOrValue => valueUpdater(updaterOrValue, sorting),
    onColumnFiltersChange: updaterOrValue => valueUpdater(updaterOrValue, columnFilters),
    onColumnVisibilityChange: updaterOrValue => valueUpdater(updaterOrValue, columnVisibility),
    onRowSelectionChange: updaterOrValue => valueUpdater(updaterOrValue, rowSelection),
    onExpandedChange: updaterOrValue => valueUpdater(updaterOrValue, expanded),
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
        get expanded() {
            return expanded.value
        },
    },
})

const existingSelection = {}
props.selectedObjects.forEach(s => {
    existingSelection[s.metaRowId] = true
})

valueUpdater(existingSelection, rowSelection)

const limitHeight = props.limitHeight
</script>

<template>
  <div class="space-y-2">
    <DataTableToolbar :filters="filters" :table="table">
      <template #left>
        <slot name="toolbar-left" :table="table"></slot>
      </template>
      <template #right>
        <div class="relative">
          <Input
              class="max-w-sm"
              icon="search"
              placeholder="Search..."
              :model-value="props.searchKey ? table.getColumn(props.searchKey)?.getFilterValue() as string : table.getState().globalFilter"
              @update:model-value="props.searchKey ? table.getColumn(props.searchKey)?.setFilterValue($event) : table.setGlobalFilter(String($event))"
          />
        </div>
        <slot name="toolbar-right" :table="table" :selected-objects="table.getSelectedRowModel().rows.map(r => {return {...r.original, metaRowId: r.id}})"></slot>
      </template>
    </DataTableToolbar>
    <slot name="below-toolbar"></slot>
    <div class="rounded-md border" :class="{'max-h-[50vh] overflow-auto': limitHeight}">
      <Table>
        <TableHeader>
          <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <TableHead v-for="header in headerGroup.headers" :key="header.id">
              <FlexRender v-if="!header.isPlaceholder" :render="header.column.columnDef.header" :props="header.getContext()"/>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="table.getRowModel().rows?.length">
            <template v-for="row in table.getRowModel().rows" :key="row.id">
              <TableRow class="cursor-pointer" :data-state="row.getIsSelected() && 'selected'" @click="() => {rowClick(row)}">
                <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                  <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()"/>
                </TableCell>
              </TableRow>
              <TableRow v-if="row.getIsExpanded()">
                <TableCell :colspan="row.getAllCells().length">
                  {{JSON.stringify(row.original)}}
                </TableCell>
              </TableRow>
            </template>
          </template>

          <TableRow v-else>
            <TableCell
                :colspan="table.getAllColumns().length"
                class="h-24 text-center"
            >
              No results.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
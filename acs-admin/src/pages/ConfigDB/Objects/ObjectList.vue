<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->
<template>
  <Skeleton v-if="!obj.ready" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTableSearchable v-else
      :data="obj.data"
      :default-sort="initialSort"
      :columns="columns"
      :filters="[]"
      :selected-objects="[]"
      :clickable="true"
      :search-key="null"
      :limit-height="false"
      @row-click="e => $emit('rowClick', e)">
    <template #toolbar-left>
      <slot></slot>
    </template>
    <template #toolbar-right>
      <slot name="toolbar-right"></slot>
    </template>
  </DataTableSearchable>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import { columns } from './TableData/objectListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useObjectStore} from "@store/useObjectStore.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";

export default {
  emits: ['rowClick'],

  setup () {
    return {
      columns: columns,
      obj: useObjectStore(),
    }
  },

  components: {
    Card,
    Skeleton,
    DataTableSearchable,
  },

  computed: {
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    }
  },

  data() {
    return {
    }
  }
}
</script>
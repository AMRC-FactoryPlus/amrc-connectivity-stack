<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="!obj.ready" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="obj.data" :default-sort="initialSort" :columns="columns" :filters="[]" @row-click="e => $emit('rowClick', e)"/>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './objectListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useObjectStore} from "@store/useObjectStore.js";

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
    DataTable,
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
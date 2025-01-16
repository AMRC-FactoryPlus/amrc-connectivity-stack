<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="g.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="p.data" :columns="columns" :filters="[{
        name: 'Name',
        property: 'name',
        options: filterOptions.names
      }, {
        name: 'Group Type',
        property: 'class',
        options: filterOptions.class
      }, {
        name: 'UUID',
        property: 'uuid',
        options: filterOptions.uuids,
      }, {
        name: 'Member Count',
        property: 'memberCount',
        options: filterOptions.memberCount,
      }]" @row-click="e => $emit('rowClick', e)"/>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './groupListColumns.ts'
import { usePermissionStore } from "@store/usePermissionStore.js";

export default {
  name: 'PermissionList',

  emits: ['rowClick'],

  setup () {
    return {
      p: usePermissionStore(),
      columns: columns,
    }
  },

  components: {
    Skeleton,
    DataTable,
  },

  computed: {

    filterOptions () {
      return {
        names: this.p.data.map((g) => g.name).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
          return {
            label: g,
            value: g,
          }
        }),
        uuids: this.p.data.map((g) => g.uuid).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
          return {
            label: g,
            value: g,
          }
        }),
      }
    },
  },
}
</script>
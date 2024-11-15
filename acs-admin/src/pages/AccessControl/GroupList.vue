<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="g.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="g.data" :columns="columns" :filters="[{
        name: 'Name',
        property: 'name',
        options: filterOptions.names
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
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useGroupStore } from '@store/useGroupStore.js'
import { columns } from './groupListColumns.ts'

export default {
  name: 'PrincipalList',

  emits: ['rowClick'],

  setup () {
    return {
      s: useServiceClientStore(),
      g: useGroupStore(),
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
        names: this.g.data.map((g) => g.name).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
          return {
            label: g,
            value: g,
          }
        }),
        uuids: this.g.data.map((g) => g.uuid).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
          return {
            label: g,
            value: g,
          }
        }),
        memberCount: this.g.data.map((g) => g.members.length).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
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
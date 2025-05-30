<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="p.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="p.data" :default-sort="initialSort" :columns="columns" :filters="[{
        name: 'Name',
        property: 'name',
        options: filterOptions.names,
      }, {
        name: 'Account Type',
        property: 'class',
        options: filterOptions.class,
      }, {
        name: 'Principal',
        property: 'kerberos',
        options: filterOptions.principals,
      }, {
        name: 'UUID',
        property: 'uuid',
        options: filterOptions.uuids,
      }]" @row-click="e => $emit('rowClick', e)"/>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { columns } from './principalListColumns.ts'

export default {
  name: 'PrincipalList',

  emits: ['rowClick'],

  setup () {
    return {
      p: usePrincipalStore(),
      columns: columns,
    }
  },

  components: {
    Skeleton,
    DataTable,
  },

  computed: {
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
    filterOptions () {
      return {
        names: this.p.data.map((p) => p.name).filter((v, i, a) => a.indexOf(v) === i).map((p) => {
          return {
            label: p,
            value: p,
          }
        }),
        principals: this.p.data.map((p) => p.kerberos).filter((v, i, a) => a.indexOf(v) === i).map((p) => {
          return {
            label: p,
            value: p,
          }
        }),
        class: this.p.data.map((p) => p.class.name).filter((v, i, a) => a.indexOf(v) === i).map((p) => {
          return {
            label: p,
            value: p,
          }
        }),
        uuids: this.p.data.map((p) => p.uuid).filter((v, i, a) => a.indexOf(v) === i).map((p) => {
          return {
            label: p,
            value: p,
          }
        }),
      }
    },
  },
}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->
<template>
  <Skeleton v-if="p.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="p.data" :default-sort="initialSort" :columns="columns" :filters="filters" @row-click="e => $emit('rowClick', e)"/>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './permissionListColumns.ts'
import { usePermissionStore } from '@store/usePermissionStore.js'

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
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
    filters () {
      return [
        {
          name: 'Name',
          property: 'name',
          options: this.p.data.map((g) => g.name).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
            return {
              label: g,
              value: g,
            }
          }),
        }, {
          name: 'Permission Type',
          property: 'class',
          options: this.p.data.map((g) => g.class.name).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
            return {
              label: g,
              value: g,
            }
          }),
        }, {
          name: 'UUID',
          property: 'uuid',
          options: this.p.data.map((g) => g.uuid).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
            return {
              label: g,
              value: g,
            }
          }),
        },
      ]
    },
  },
}
</script>
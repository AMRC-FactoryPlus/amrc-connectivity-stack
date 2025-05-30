<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.groups" :default-sort="initialSort" :columns="columns" :filters="[]" @row-click="e => $emit('objectClick', e)">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Group Memberships</AlertTitle>
            <AlertDescription>
              Manage this permissions membership to groups.
            </AlertDescription>
          </div>
        </div>
      </Alert>
    </template>
  </DataTable>
</template>

<script>
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { columns } from './groupColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useGroupStore } from '@store/useGroupStore.js'

export default {
  setup () {
    return {
      columns,
      g: useGroupStore(),
    }
  },

  emits: ['objectClick'],

  components: {
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
  },

  props: {
    permission: {
      type: Object,
      required: true,
    },
  },

  computed: {
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
    groups () {
      if (this.g.loading) {
        return []
      }

      this.loading = false

      return this.g.data.filter(group => {
        return group.members.includes(this.permission.uuid)
      })
    },
  },

  data () {
    return {
      loading: false,
    }
  },

}
</script>
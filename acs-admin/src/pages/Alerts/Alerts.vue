<template>
  <DataTable :columns="columns" :data="a.alerts" />
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useAlertsStore } from '@/store/useAlertsStore.js'
import DataTable from '@/components/ui/data-table/DataTable.vue'

import { columns } from "./columns"

export default {

  name: 'Alerts',

  components: {
    DataTable
  },

  setup () {
    return {
      s: useServiceClientStore(),
      a: useAlertsStore(),
      columns
    }
  },

  mounted () {
    this.alertWatcher = this.a.watchAlerts(this.s.client)
  },

  beforeUnmount () {
    this.alertWatcher()
  },
}
</script>

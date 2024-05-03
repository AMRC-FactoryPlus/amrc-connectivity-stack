<template>
  <DataTable :data="a.alerts" :columns="columns"/>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useAlertsStore } from '@/store/useAlertsStore.js'

import { columns } from './columns'
import DataTable from '@/pages/Alerts/DataTable.vue'

export default {

  name: 'Alerts',

  components: { DataTable },

  setup () {
    return {
      s: useServiceClientStore(),
      a: useAlertsStore(),
      columns,
    }
  },

  mounted () {
    this.alertWatcher = this.a.watchAlerts(this.s.client)
  },

  beforeUnmount () {
    if (this.alertWatcher) this.alertWatcher()
  },
}
</script>

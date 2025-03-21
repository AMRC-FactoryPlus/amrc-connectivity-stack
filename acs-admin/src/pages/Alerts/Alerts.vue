<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <DataTable
      :data="a.alerts"
      :columns="columns"
      :default-sort="[{ id: 'since', desc: true }]"
      :filters="[{
        name: 'Type',
        property: 'type',
        options: types
      }, {
        name: 'Device',
        property: 'device',
        options: devices
      }]"/>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useAlertStore } from '@store/useAlertStore.js'

import { columns } from './columns'
import DataTable from '@/components/ui/data-table/DataTable.vue'

export default {

  name: 'Alerts',

  components: { DataTable },

  setup () {
    return {
      s: useServiceClientStore(),
      a: useAlertStore(),
      columns,
    }
  },

  computed: {
    types () {
      const types = new Set()
      this.a.alerts.forEach((a) => types.add({
        label: a.type,
        value: a.type,
      }))
      return Array.from(types)
    },

    devices () {
      const devices = new Set()
      this.a.alerts.forEach((a) => devices.add({
        label: a.device,
        value: a.device,
      }))
      return Array.from(devices)
    },
  },

  mounted () {
    this.alertWatcher = this.a.watchAlerts(this.s.client)
  },

  beforeUnmount () {
    if (this.alertWatcher) this.alertWatcher()
  },
}
</script>

<template>
  <Sheet :open="selectedRow" @update:open="handleSheetOpen">
    <EffectivePermissions :selected-row="selectedRow"></EffectivePermissions>
  </Sheet>
  <Skeleton v-if="loading" v-for="i in 10" class="h-10 rounded-lg"/>
  <DataTable v-else :data="aces" :columns="columns" :filters="[{
    name: 'Principal',
    property: 'kerberos',
    options: principals
  }, {
    name: 'UUID',
    property: 'uuid',
    options: uuids,
  }]" @row-click="rowClick"/>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './columns'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { defineAsyncComponent } from 'vue'

export default {
  name: 'AccessControl',

  components: {
    DataTable,
    Skeleton,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    EffectivePermissions: defineAsyncComponent(() => import('./EffectivePermissions.vue')),
  },

  async mounted () {

    this.loading = true

    this.s.client.Auth.fetch('authz/principal').then((returnObject) => {

      this.aces    = returnObject[1]
      this.loading = false

    }).catch((err) => {
      console.error(`Can't read ACEs`, err)
    })

  },

  computed: {
    principals () {
      const principals = new Set()
      this.aces.forEach((a) => principals.add({
        label: a.kerberos,
        value: a.kerberos,
      }))
      return Array.from(principals)
    },

    uuids () {
      const uuids = new Set()
      this.aces.forEach((a) => uuids.add({
        label: a.uuid,
        value: a.uuid,
      }))
      return Array.from(uuids)
    },
  },

  methods: {
    rowClick (row) {
      this.selectedRow = row.original
    },

    handleSheetOpen (open) {
      if (!open) {
        this.selectedRow = null
      }
    },
  },

  setup () {
    return {
      s: useServiceClientStore(),
      columns,
    }
  },

  data () {
    return {
      loading: false,
      aces: [],
      selectedRow: null,
    }
  },
}
</script>

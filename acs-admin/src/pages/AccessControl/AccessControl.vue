<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Sheet :open="selectedRow" @update:open="handleSheetOpen">
    <PrincipalManagementSidebar :selected-row="selectedRow"></PrincipalManagementSidebar>
  </Sheet>
  <Tabs default-value="principals">
    <TabsList class="mb-3">
      <TabsTrigger value="principals">
        Principals
      </TabsTrigger>
      <TabsTrigger disabled value="groups">
        Groups
      </TabsTrigger>
      <TabsTrigger disabled value="permissions">
        Permissions
      </TabsTrigger>
    </TabsList>
    <TabsContent value="principals">
      <Skeleton v-if="loading" v-for="i in 10" class="h-10 rounded-lg"/>
      <DataTable v-else :data="principals" :columns="columns" :filters="[{
    name: 'Principal',
    property: 'kerberos',
    options: principals
  }, {
    name: 'UUID',
    property: 'uuid',
    options: uuids,
  }]" @row-click="rowClick"/>
    </TabsContent>
    <TabsContent value="password">
      Change your password here.
    </TabsContent>
  </Tabs>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './columns'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { defineAsyncComponent } from 'vue'
import { Button } from '@components/ui/button/index.js'

export default {
  name: 'AccessControl',

  components: {
    Button,
    DataTable,
    Skeleton,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    PrincipalManagementSidebar: defineAsyncComponent(() => import('./PrincipalManagementSidebar.vue')),
  },

  async mounted () {

    this.loading = true

    this.getPrincipals()

  },

  computed: {

    uuids () {
      const uuids = new Set()
      this.principals.forEach((a) => uuids.add({
        label: a.uuid,
        value: a.uuid,
      }))
      return Array.from(uuids)
    },
  },

  methods: {

    getPrincipals () {
      this.s.client.Auth.fetch('authz/principal').then((returnObject) => {

        this.principals = returnObject[1].map((p) => {
          return {
            uuid: p.uuid,
            kerberos: p.kerberos,
          }
        })
        this.loading    = false

      }).catch((err) => {
        console.error(`Can't read principals`, err)
      })
    },

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
      principals: [],
      selectedRow: null,
    }
  },
}
</script>

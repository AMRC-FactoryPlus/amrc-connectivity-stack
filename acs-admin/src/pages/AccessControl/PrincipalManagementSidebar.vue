<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="selectedRow" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle>{{selectedRow.kerberos}}</SheetTitle>
      <SheetDescription>
        {{selectedRow.uuid}}
      </SheetDescription>
    </SheetHeader>
    <div>
      <Skeleton v-if="loading" v-for="i in 10" class="h-10 rounded-lg"/>
      <DataTable v-else :data="permissions" :columns="columns">
        <template #toolbar-left>
          <div class="font-bold">Privileges</div>
        </template>
      </DataTable>
    </div>
  </SheetContent>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@components/ui/sheet/index.js'
import { Skeleton } from '@components/ui/skeleton/index.js'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './columnsEffectivePermissions.ts'
import { UUIDs } from '@amrc-factoryplus/service-client'

export default {

  name: 'PrincipalManagementSidebar',

  components: {
    DataTable,
    Skeleton,
    SheetHeader,
    SheetTitle,
    SheetContent,
    SheetDescription,
  },

  props: {
    selectedRow: {
      type: Object,
      default: null,
    },
  },

  watch: {
    selectedRow: {
      handler (val) {
        if (val == null) {
          return
        }

        this.fetchPermissionsForPrincipal(val.kerberos)
      },
      immediate: true,
    },
  },

  methods: {
    async fetchPermissionsForPrincipal (principal) {

      this.loading = true

      const res = await this.s.client.Auth.fetch(`/authz/effective/${principal}`)

      const info = o => this.s.client.ConfigDB.get_config(UUIDs.App.Info, o)
      const name = o => info(o).then(v => v?.name)

      const rv = []
      for (const effective of res[1]) {
        const permissionName = await name(effective.permission)
        const targetName     = await name(effective.target)

        rv.push({
          permission: {
            uuid: effective.permission,
            name: permissionName,
          },
          target: {
            uuid: effective.target,
            name: targetName,
          },
        })
      }

      this.loading     = false
      this.permissions = rv
    },
  },

  setup () {
    return {
      columns,
      s: useServiceClientStore(),
    }
  },

  data () {
    return {
      loading: false,
      permissions: [],
    }
  },
}
</script>

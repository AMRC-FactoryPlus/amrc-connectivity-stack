<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="loading || p.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.permissions" :columns="columns" :filters="[]" @row-click="e => $emit('objectClick', e)">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Permissions</AlertTitle>
            <AlertDescription>
              Manage the permissions that are assigned to this principal.
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
import { columns } from './permissionColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { usePermissionStore } from "@store/usePermissionStore.js";
import { UUIDs } from "@amrc-factoryplus/service-client";
import { useServiceClientStore } from "@store/serviceClientStore.js";

export default {
  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePermissionStore(),
      s: useServiceClientStore(),
    }
  },

  components: {
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
  },

  props: {
    principal: {
      type: Object,
      required: true,
    },
  },

  watch: {
    principal: {
      handler (val) {
        if (val == null) {
          return
        }

        this.fetchSpecificPermissions(val.uuid)
      },
      immediate: true,
    },
  },

  methods: {
    async fetchSpecificPermissions (uuid) {
      this.loading = true

      const res = await this.s.client.Auth.fetch(`/authz/ace`)
      if (!Array.isArray(res[1])) {
        return;
      }
      const fullList = res[1];
      const filteredList = fullList.filter(e => e.principal === uuid)

      const info = o => this.s.client.ConfigDB.get_config(UUIDs.App.Info, o)
      const name = o => info(o).then(v => v?.name)

      const rv = []
      for (const entry of filteredList) {
        const permissionName = this.p.data.find(v => v.uuid === entry.permission)?.name
        const targetName     = await name(entry.target)

        rv.push({
          permission: {
            uuid: entry.permission,
            name: permissionName,
          },
          target: {
            uuid: entry.target,
            name: targetName,
          },
        })
      }

      this.permissions = rv
      this.loading     = false
    },
  },

  data () {
    return {
      loading: false,
      permissions: []
    }
  },

}
</script>
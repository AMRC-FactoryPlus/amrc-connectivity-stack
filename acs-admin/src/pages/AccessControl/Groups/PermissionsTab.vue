<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="p.loading || grants.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
<!--  <DataTable v-else :data="this.permissions" :columns="columns" :filters="[]" @row-click="e => $emit('objectClick', e)">-->
  <DataTable v-else :data="this.permissions" :columns="columns" :filters="[]">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Permissions</AlertTitle>
            <AlertDescription>
              Manage the permissions that are assigned to this group.
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
import {useGrantStore} from "@store/useGrantStore.js";

export default {
  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePermissionStore(),
      s: useServiceClientStore(),
      grants: useGrantStore()
    }
  },

  provide () {
    return {
      permissionMembershipUpdated: this.updateData,
      objectClicked: (object) => {this.$emit('objectClick', object)},
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
    group: {
      type: Object,
      required: true,
    },
  },

  watch: {
    group: {
      handler (val) {
        if (val == null) {
          return
        }

        this.fetchSpecificPermissions()
      },
      immediate: true,
    },
  },

  methods: {
    async fetchSpecificPermissions() {
      this.loading = true

      const fullList = this.grants.data
      const filteredList = fullList.filter(e => e.principal === this.group.uuid)

      const info = o => this.s.client.ConfigDB.get_config(UUIDs.App.Info, o)
      const name = o => info(o).then(v => v?.name)

      const rv = []
      for (const entry of filteredList) {
        const permission = await this.p.getPermission(entry.permission)
        const targetName     = await name(entry.target)

        rv.push({
          permission,
          target: {
            uuid: entry.target,
            name: targetName,
          },
          group: this.group,
        })
      }

      this.permissions = rv
      this.loading     = false
    },
    async updateData () {
      this.s.client.Fetch.cache = 'reload'
      await this.fetchSpecificPermissions()
      this.s.client.Fetch.cache = 'default'
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
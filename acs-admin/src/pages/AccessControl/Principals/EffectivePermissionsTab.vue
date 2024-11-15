<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="permissions" :columns="columns" :filters="[]">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Effective Permissions</AlertTitle>
            <AlertDescription>
              Effective Permissions show each permission that this Principal has assigned to it (either directly or via membership of a group) and its target.
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
import { columns } from './effectivePermissionsColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@/store/serviceClientStore.js'

export default {
  name: 'EffectivePermissions',

  setup () {
    return {
      columns,
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

        this.fetchEffectivePermissions(val.kerberos)
      },
      immediate: true,
    },
  },

  methods: {
    async fetchEffectivePermissions (principal) {

      this.loading = true

      const res = await this.s.client.Auth.fetch(`/authz/effective/${principal}`)

      const info = o => this.s.client.ConfigDB.get_config(UUIDs.App.Info, o)
      const name = o => info(o).then(v => v?.name)

      const rv = []
      if (Array.isArray(res[1])) {
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
      }

      this.loading     = false
      this.permissions = rv
    },
  },

  data () {
    return {
      loading: false,
      permissions: [],
    }
  },

}
</script>
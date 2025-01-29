<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Skeleton v-if="loading || p.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.permissions" :columns="columns" :filters="[]">
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
    <template #below-toolbar>
      <ObjectSelector
          v-model="permissionsToAdd"
          :store-data="p.data"
          title="Select Permissions"
          subtitle="Select permissions which the principal should be granted, targets can be selected next"
          detail-header="UUID"
          detail-key="uuid"
          title-header="Name"
          title-key="name"
          confirm-text="Choose Targets"
          confirm-icon="arrow-right-long"
      >
        <Button>Grant Permissions</Button>
      </ObjectSelector>
    </template>
  </DataTable>
  <ObjectSelector
      v-model:open="isTargetSelectorOpen"
      v-model="targetsToAdd"
      :store-data="pr.data"
      title="Select Targets"
      :subtitle="targetsSubtitle"
      detail-header="UUID"
      detail-key="uuid"
      title-header="Name"
      title-key="name"
  >
  </ObjectSelector>
</template>

<script>
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { columns } from './permissionColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { usePermissionStore } from '@store/usePermissionStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { Button } from '@components/ui/button/index.js'
import { defineAsyncComponent } from 'vue'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { toast } from 'vue-sonner'

export default {
  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePermissionStore(),
      s: useServiceClientStore(),
      pr: usePrincipalStore()
    }
  },

  provide () {
    return {
      permissionMembershipUpdated: this.updateData,
      objectClicked: (object) => {this.$emit('objectClick', object)}
    }
  },

  components: {
    Button,
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
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
    permissionsToAdd: async function(val, oldVal) {
      if (!val.length) {
        this.isTargetSelectorOpen = false
        return
      }

      this.isTargetSelectorOpen = true
    },
    targetsToAdd: async function(val, oldVal) {
      if (!val.length) {
        this.permissionsToAdd = []
        return
      }

      for (const permission of this.permissionsToAdd) {
        for (const target of val) {
          await this.addEntry(this.principal, permission, target)
        }
      }
      await this.updateData()
    }
  },

  computed: {
    targetsSubtitle () {
      return `Select targets for which the selected permission should be granted: ${this.permissionsToAdd.map(p => p.name).join(", ")}`
    }
  },

  methods: {
    async fetchSpecificPermissions () {
      this.loading = true

      const res = await this.s.client.Auth.fetch(`/authz/ace`)
      if (!Array.isArray(res[1])) {
        return;
      }
      const fullList = res[1];
      const filteredList = fullList.filter(e => e.principal === this.principal.uuid)

      const info = o => this.s.client.ConfigDB.get_config(UUIDs.App.Info, o)
      const classGet = o => this.s.client.ConfigDB.get_config(UUIDs.App.Registration, o).then(v => v?.class)
      const name = o => info(o).then(v => v?.name)

      const rv = []
      for (const entry of filteredList) {
        const permissionLookup = this.p.data.find(v => v.uuid === entry.permission)
        const permissionName   = permissionLookup?.name ?? await name(entry.permission)
        const permissionClass  = permissionLookup?.class?.uuid ?? await classGet(entry.permission)
        const targetName       = await name(entry.target)
        const targetClass      = await classGet(entry.target)

        rv.push({
          permission: {
            uuid: entry.permission,
            name: permissionName,
            class: {
              uuid: permissionClass
            }
          },
          target: {
            uuid: entry.target,
            name: targetName,
            class: {
              uuid: targetClass
            }
          },
          principal: {
            uuid: this.principal.uuid,
            name: this.principal.name
          }
        })
      }

      this.permissions = rv
      this.loading     = false
    },
    async updateData() {
      this.s.client.Fetch.cache = "reload"
      await this.fetchSpecificPermissions()
      this.s.client.Fetch.cache = "default"
    },
    async addEntry(principal, permission, target) {
      try {
        await this.s.client.Auth.add_ace(principal.uuid, permission.uuid, target.uuid)
        toast.success(`${this.principal.name} has been granted ${permission.name} on ${target.name}`)
      } catch (err) {
        toast.error(`Unable to grant ${permission.name} to ${this.principal.name} on ${target.name}`)
        console.error(`Unable to grant ${permission.name} to ${this.principal.name} on ${target.name}`, err)
      }
    }
  },

  data () {
    return {
      loading: false,
      permissions: [],
      permissionsToAdd: [],
      targetsToAdd: [],
      isTargetSelectorOpen: false
    }
  },

}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Skeleton v-if="p.loading || pr.loading || grants.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
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
          v-model:open="isPermissionSelectorOpen"
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
      :store-data="availableTargets"
      title="Select Targets"
      :subtitle="targetsSubtitle"
      detail-header="UUID"
      detail-key="uuid"
      title-header="Name"
      title-key="name"
  >
    <template #actions>
      <Button @click="isTargetSelectorOpen = false; isPermissionSelectorOpen = true"><i class="fa-solid fa-arrow-left-long"></i> &nbsp; Return to Permissions</Button>
    </template>
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
import {useGrantStore} from "@store/useGrantStore.js";
import {useGroupStore} from "@store/useGroupStore.js";
import {useObjectStore} from "@store/useObjectStore.js";

export default {
  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePermissionStore(),
      s: useServiceClientStore(),
      pr: usePrincipalStore(),
      g: useGroupStore(),
      grants: useGrantStore(),
      obj: useObjectStore(),
    }
  },

  provide () {
    return {
      permissionMembershipUpdated: this.updateData,
      objectClicked: (object) => {this.$emit('objectClick', object)},
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
    permissionsToAdd: async function (val, oldVal) {
      if (!val.length) {
        this.isTargetSelectorOpen = false
        return
      }

      this.isTargetSelectorOpen = true
    },

    targetsToAdd: async function (val, oldVal) {
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
      this.targetsToAdd = []
    },
  },

  computed: {
    permissions () {
      this.loading = true

      const fullList = this.grants.data
      const filteredList = fullList.filter(e => e.principal === this.principal.uuid)

      const rv = []
      for (const entry of filteredList) {
        const permissionLookup = this.p.data.find(e => e.uuid === entry.permission)
        const targetLookup     = entry.target === UUIDs.Special.Null ? { uuid: UUIDs.Special.Null, name: 'Wildcard'} :
            this.pr.data.find(e => e.uuid === entry.target) ??
            this.g.data.find(e => e.uuid === entry.target) ??
            this.obj.data.find(e => e.uuid === entry.target) ??
            {
              uuid: entry.target,
              name: "UNKNOWN"
            }

        rv.push({
          uuid: entry.uuid,
          permission: permissionLookup,
          target: targetLookup,
          principal: {
            uuid: this.principal.uuid,
            name: this.principal.name,
          },
        })
      }

      this.loading = false
      return rv
    },
    targetsSubtitle () {
      return `Select targets for which the selected permission(s) should be granted: ${this.permissionsToAdd.map(p => p.name).join(', ')}`
    },
    availableTargets () {
      const wildcard = [{
        uuid: UUIDs.Special.Null,
        name: 'Wildcard'
      }]
      return wildcard.concat(this.obj.data)
    }
  },

  methods: {
    async updateData () {
      this.s.client.Fetch.cache = 'reload'
      await this.grants.fetch()
      this.s.client.Fetch.cache = 'default'
    },
    async addEntry (principal, permission, target) {
      try {
        const grant = {
          principal: principal.uuid,
          permission: permission.uuid,
          target: target.uuid,
          plural: false
        }
        await this.s.client.Auth.add_grant(grant)
        toast.success(`${principal.name} has been granted ${permission.name} on ${target.name}`)
      }
      catch (err) {
        toast.error(`Unable to grant ${permission.name} to ${principal.name} on ${target.name}`)
        console.error(`Unable to grant ${permission.name} to ${principal.name} on ${target.name}`, err)
      }
    },
  },

  data () {
    return {
      loading: false,
      permissionsToAdd: [],
      targetsToAdd: [],
      isPermissionSelectorOpen: false,
      isTargetSelectorOpen: false,
    }
  },

}
</script>
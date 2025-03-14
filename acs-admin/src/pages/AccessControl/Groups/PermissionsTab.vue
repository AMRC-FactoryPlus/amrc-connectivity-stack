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
    <template #below-toolbar>
      <ObjectSelector
          v-model="permissionsToAdd"
          v-model:open="isPermissionSelectorOpen"
          :store-data="p.data"
          title="Select Permissions"
          subtitle="Select permissions which the group should be granted, targets can be selected next"
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
      :store-data="g.data"
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
import { usePermissionStore } from "@store/usePermissionStore.js";
import { UUIDs } from "@amrc-factoryplus/service-client";
import { useServiceClientStore } from "@store/serviceClientStore.js";
import {useGrantStore} from "@store/useGrantStore.js";
import {Button} from "@components/ui/button/index.js";
import {defineAsyncComponent} from "vue";
import {toast} from "vue-sonner";
import {useGroupStore} from "@store/useGroupStore.js";

export default {
  emits: ['objectClick'],

  setup () {
    return {
      columns,
      s: useServiceClientStore(),
      p: usePermissionStore(),
      g: useGroupStore(),
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
    Button,
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
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

      console.log(this.permissionsToAdd)
      console.log(val)
      for (const permission of this.permissionsToAdd) {
        for (const target of val) {
          await this.addEntry(this.group, permission, target)
        }
      }
      await this.updateData()
    },
  },

  computed: {
    targetsSubtitle () {
      return `Select targets for which the selected permission should be granted: ${this.permissionsToAdd.map(p => p.name).join(', ')}`
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
          uuid: entry.uuid,
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
      await this.grants.fetch()
      await this.fetchSpecificPermissions()
      this.s.client.Fetch.cache = 'default'
    },
    async addEntry (group, permission, target) {
      try {
        // await this.s.client.Auth.add_ace(group.uuid, permission.uuid, target.uuid)
        await this.s.client.Auth.fetch({
          method: "POST",
          url: "v2/grant",
          body: {
            principal: group.uuid,
            permission: permission.uuid,
            target: target.uuid,
            plural: true
          }
        })
        toast.success(`${this.group.name} has been granted ${permission.name} on ${target.name}`)
      }
      catch (err) {
        toast.error(`Unable to grant ${permission.name} to ${this.group.name} on ${target.name}`)
        console.error(`Unable to grant ${permission.name} to ${this.group.name} on ${target.name}`, err)
      }
    },
  },

  data () {
    return {
      loading: false,
      permissions: [],
      permissionsToAdd: [],
      targetsToAdd: [],
      isPermissionSelectorOpen: false,
      isTargetSelectorOpen: false,
    }
  },

}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="permissionDetails" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle title="Name">{{ permissionDetails.name }}</SheetTitle>
      <SheetTitle title="Permission Class" class="text-gray-500">{{ permissionDetails.class?.name ?? "Permission" }} - Permission</SheetTitle>
      <SheetDescription>
        <Copyable :text="permissionDetails.uuid">{{permissionDetails.uuid}}</Copyable>
      </SheetDescription>
    </SheetHeader>
    <div>
      <ObjectSelector
          v-model="principalsToAdd"
          v-model:open="isPrincipalSelectorOpen"
          :store-data="availablePrincipals"
          title="Select Principals"
          subtitle="Select principals or groups for which the permission should be granted, targets can be selected next"
          column1-header="Name"
          column1-main-key="name"
          column1-sub-key="uuid"
          column2-header="Class"
          column2-main-key="class.name"
          column2-sub-key="class.uuid"
          confirm-text="Choose Targets"
          confirm-icon="arrow-right-long"
      >
        <Button>Grant this Permission</Button>
      </ObjectSelector>
      <ObjectSelector
          v-model:open="isTargetSelectorOpen"
          v-model="targetsToAdd"
          :store-data="availableTargets"
          title="Select Targets"
          :subtitle="targetsSubtitle"
          column1-header="Name"
          column1-main-key="name"
          column1-sub-key="uuid"
          column2-header="Class"
          column2-main-key="class.name"
          column2-sub-key="class.uuid"
      >
        <template #actions>
          <Button @click="isTargetSelectorOpen = false; isPrincipalSelectorOpen = true"><i class="fa-solid fa-arrow-left-long"></i> &nbsp; Return to Permissions</Button>
        </template>
      </ObjectSelector>
      <Tabs default-value="principals" class="mt-6">
        <TabsList class="mb-2">
          <TabsTrigger value="principals">
            Entries
          </TabsTrigger>
          <TabsTrigger value="groups">
            Groups
          </TabsTrigger>
        </TabsList>
        <TabsContent value="principals">
          <PrincipalsTab :permission="permissionDetails" @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
        <TabsContent value="groups">
          <GroupsTab :permission="permissionDetails" @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
      </Tabs>
    </div>
  </SheetContent>
</template>

<script>
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@components/ui/sheet/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import PrincipalsTab from './PrincipalsTab.vue'
import GroupsTab from "./GroupsTab.vue";
import {usePermissionStore} from "@store/usePermissionStore.js";
import Copyable from "@components/Copyable.vue";
import {Button} from "@components/ui/button/index.js";
import {defineAsyncComponent} from "vue";
import {usePrincipalStore} from "@store/usePrincipalStore.js";
import {UUIDs} from "@amrc-factoryplus/service-client";
import {useGroupStore} from "@store/useGroupStore.js";
import {toast} from "vue-sonner";
import {useGrantStore} from "@store/useGrantStore.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {useObjectStore} from "@store/useObjectStore.js";

export default {
  name: 'PermissionManagementSidebar',

  setup () {
    return {
      s: useServiceClientStore(),
      p: usePermissionStore(),
      pr: usePrincipalStore(),
      g: useGroupStore(),
      grants: useGrantStore(),
      obj: useObjectStore(),
    }
  },

  emits: ['objectClick'],

  components: {
    Button,
    Copyable,
    SheetHeader,
    SheetTitle,
    SheetContent,
    SheetDescription,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    PrincipalsTab,
    GroupsTab,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
  },

  watch: {
    permission: {
      async handler(newPermission) {
        if (!newPermission) {
          this.permissionDetails = null
          return;
        }
        this.permissionDetails = await this.p.getPermission(this.permission.uuid)
      },
      immediate: true,
    },

    principalsToAdd: async function (val, oldVal) {
      if (!val.length) {
        this.isTargetSelectorOpen = false
        return
      }

      this.isTargetSelectorOpen = true
    },

    targetsToAdd: async function (val, oldVal) {
      if (!val.length) {
        this.principalsToAdd = []
        return
      }

      for (const principal of this.principalsToAdd) {
        for (const target of val) {
          await this.addEntry(principal, this.permissionDetails, target)
        }
      }
      await this.updateData()
      this.targetsToAdd = []
    },
  },

  props: {
    permission: {
      type: Object,
      default: null,
    },
  },

  computed: {
    targetsSubtitle () {
      return `Select targets for which the selected principals should be granted this permission: ${this.principalsToAdd.map(p => p.name).join(', ')}`
    },
    availablePrincipals () {
      return this.pr.data.concat(this.g.data)
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

  data() {
    return {
      permissionDetails: null,
      principalsToAdd: [],
      isPrincipalSelectorOpen: false,
      targetsToAdd: [],
      isTargetSelectorOpen: false,
    }
  }
}
</script>

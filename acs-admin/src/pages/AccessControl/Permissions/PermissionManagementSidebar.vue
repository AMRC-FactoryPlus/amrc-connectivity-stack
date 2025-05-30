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
          <Button variant="outline" @click="() => {targetPlural = !targetPlural}"><Checkbox :model-value="targetPlural" @click="() => {targetPlural = !targetPlural}"></Checkbox> &nbsp; Plural</Button>
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
import EntriesTab from './EntriesTab.vue'
import GroupsTab from "./GroupsTab.vue";
import {usePermissionStore} from "@store/usePermissionStore.js";
import Copyable from "@components/Copyable.vue";
import {Button} from "@components/ui/button/index.js";
import {defineAsyncComponent} from "vue";
import {usePrincipalStore} from "@store/usePrincipalStore.js";
import {useGroupStore} from "@store/useGroupStore.js";
import {toast} from "vue-sonner";
import {useGrantStore} from "@store/useGrantStore.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {useObjectStore} from "@store/useObjectStore.js";
import {Checkbox} from "@components/ui/checkbox/index.js";

export default {
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
    Checkbox,
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
    PrincipalsTab: EntriesTab,
    GroupsTab,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
  },

  watch: {
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
      this.targetPlural = false
    },
  },

  props: {
    permission: {
      type: Object,
      default: null,
    },
  },

  computed: {
    permissionDetails() {
      if (!this.permission) {
        return
      }

      return this.p.data.find(item => item.uuid === this.permission.uuid)
    },
    targetsSubtitle () {
      return `Select targets for which the selected principals should be granted this permission: ${this.principalsToAdd.map(p => p.name).join(', ')}`
    },
    availablePrincipals () {
      return this.pr.data.concat(this.g.data)
    },
    availableTargets () {
      // Wildcard already included
      return this.obj.data
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
          plural: this.targetPlural
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
      principalsToAdd: [],
      isPrincipalSelectorOpen: false,
      targetsToAdd: [],
      isTargetSelectorOpen: false,
      targetPlural: false,
    }
  }
}
</script>

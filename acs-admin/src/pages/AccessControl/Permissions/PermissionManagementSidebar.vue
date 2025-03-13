<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="permissionDetails" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle title="Permission Class">{{ permissionDetails.class?.name ?? "Permission" }}</SheetTitle>
      <SheetTitle title="Name">{{ permissionDetails.name }}</SheetTitle>
      <SheetDescription>
        <Copyable :text="permissionDetails.uuid">{{permissionDetails.uuid}}</Copyable>
      </SheetDescription>
    </SheetHeader>
    <div>
      <Tabs default-value="principals">
        <TabsList class="mb-2">
          <TabsTrigger value="principals">
            Principals
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

export default {
  name: 'PermissionManagementSidebar',

  setup () {
    return {
      p: usePermissionStore(),
    }
  },

  emits: ['objectClick'],

  components: {
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
    GroupsTab
  },

  computed: {
    permissionDetails () {
      return this.permission ? this.p.data.find(item => item.uuid === this.permission.uuid) : null
    }
  },

  props: {
    permission: {
      type: Object,
      default: null,
    },
  },
}
</script>

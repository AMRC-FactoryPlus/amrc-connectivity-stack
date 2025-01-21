<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="permission" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle>{{ permission.name }}</SheetTitle>
      <SheetDescription>
        {{ permission.uuid }}
      </SheetDescription>
    </SheetHeader>
    <div>
      <Tabs default-value="principals">
        <TabsList class="mb-2">
          <TabsTrigger value="principals">
            Principals
          </TabsTrigger>
          <TabsTrigger disabled value="groups">
            Groups
          </TabsTrigger>
        </TabsList>
        <TabsContent value="principals">
          <PrincipalsTab :permission @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
        <TabsContent value="groups">
<!--          <GroupsTab :permission @objectClick="e => $emit('objectClick', e)" />-->
        </TabsContent>
      </Tabs>
    </div>
  </SheetContent>
</template>

<script>
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@components/ui/sheet/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import PrincipalsTab from './PrincipalsTab.vue'
import MembersTab from "@pages/AccessControl/Groups/MembersTab.vue";

export default {
  name: 'PermissionManagementSidebar',

  emits: ['objectClick'],

  components: {
    MembersTab,
    SheetHeader,
    SheetTitle,
    SheetContent,
    SheetDescription,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    PrincipalsTab,
  },

  props: {
    permission: {
      type: Object,
      default: null,
    },
  },
}
</script>

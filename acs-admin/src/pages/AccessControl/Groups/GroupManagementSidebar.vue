<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="group" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle>{{group.name}}</SheetTitle>
      <SheetDescription>
        {{group.uuid}}
      </SheetDescription>
    </SheetHeader>
    <div>
      <Tabs default-value="members">
        <TabsList class="mb-2">
          <TabsTrigger value="members">
            Members
          </TabsTrigger>
          <TabsTrigger value="permissions">
            Permissions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab :group @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsTab :group @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
      </Tabs>
    </div>
  </SheetContent>
</template>

<script>
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@components/ui/sheet/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs/index.js'
import MembersTab from './MembersTab.vue'
import PermissionsTab from './PermissionsTab.vue'
import DataTable from "@components/ui/data-table/DataTable.vue";

export default {
  name: 'GroupManagementSidebar',

  emits: ['objectClick'],

  components: {
    DataTable,
    SheetHeader,
    SheetTitle,
    SheetContent,
    SheetDescription,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    MembersTab,
    PermissionsTab,
  },

  props: {
    group: {
      type: Object,
      default: null,
    },
  },
}
</script>

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
          <TabsTrigger disabled value="permissions">
            Permissions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab :group/>
        </TabsContent>
        <TabsContent value="permissions">
          Permissions
        </TabsContent>
      </Tabs>
    </div>
  </SheetContent>
</template>

<script>
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@components/ui/sheet/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs/index.js'
import MembersTab from './MembersTab.vue'

export default {

  name: 'GroupManagementSidebar',

  components: {
    SheetHeader,
    SheetTitle,
    SheetContent,
    SheetDescription,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    MembersTab,
  },

  props: {
    group: {
      type: Object,
      default: null,
    },
  },
}
</script>

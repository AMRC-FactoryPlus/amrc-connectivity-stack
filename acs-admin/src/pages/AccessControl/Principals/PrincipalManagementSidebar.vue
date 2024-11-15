<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="principal" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle>{{principal.kerberos}}</SheetTitle>
      <SheetDescription>
        {{principal.uuid}}
      </SheetDescription>
    </SheetHeader>
    <div>
      <Tabs default-value="groups">
        <TabsList class="mb-2">
          <TabsTrigger value="groups">
            Groups
          </TabsTrigger>
          <TabsTrigger disabled value="permissions">
            Permissions
          </TabsTrigger>
          <TabsTrigger value="effective">
            Effective
          </TabsTrigger>
        </TabsList>
        <TabsContent value="groups">
          <GroupsTab :principal/>
        </TabsContent>
        <TabsContent value="permissions">
          Permissions
        </TabsContent>
        <TabsContent value="effective">
          <EffectivePermissionsTab :principal/>
        </TabsContent>
      </Tabs>
    </div>
  </SheetContent>
</template>

<script>
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@components/ui/sheet/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import EffectivePermissionsTab from './EffectivePermissionsTab.vue'
import GroupsTab from './GroupsTab.vue'

export default {

  name: 'PrincipalManagementSidebar',

  components: {
    SheetHeader,
    SheetTitle,
    SheetContent,
    SheetDescription,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    EffectivePermissionsTab,
    GroupsTab,
  },

  props: {
    principal: {
      type: Object,
      default: null,
    },
  },
}
</script>

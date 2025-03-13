<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="principal" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle title="Principal Class">{{ principal.class.name ?? "Principal" }}</SheetTitle>
      <SheetTitle title="Name">{{principal.name}}</SheetTitle>
      <SheetDescription>
        <Copyable :text="principal.kerberos">{{principal.kerberos}}</Copyable>
      </SheetDescription>
      <SheetDescription>
        <Copyable :text="principal.uuid">{{principal.uuid}}</Copyable>
      </SheetDescription>
    </SheetHeader>
    <div>
      <Tabs default-value="groups">
        <TabsList class="mb-2">
          <TabsTrigger value="groups">
            Groups
          </TabsTrigger>
          <TabsTrigger value="permissions">
            Permissions
          </TabsTrigger>
          <TabsTrigger value="effective">
            Effective
          </TabsTrigger>
        </TabsList>
        <TabsContent value="groups">
          <GroupsTab :principal @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsTab :principal @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
        <TabsContent value="effective">
          <EffectivePermissionsTab :principal @objectClick="e => $emit('objectClick', e)" />
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
import PermissionsTab from './PermissionsTab.vue'
import MembersTab from "@pages/AccessControl/Groups/MembersTab.vue";
import Copyable from "@components/Copyable.vue";

export default {
  name: 'PrincipalManagementSidebar',

  emits: ['objectClick'],

  components: {
    Copyable,
    MembersTab,
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
    PermissionsTab,
  },

  props: {
    principal: {
      type: Object,
      default: null,
    },
  },
}
</script>

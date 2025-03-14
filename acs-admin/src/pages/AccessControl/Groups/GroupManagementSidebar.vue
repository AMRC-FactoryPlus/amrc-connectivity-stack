<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <SheetContent v-if="groupDetails" class="gap-6 flex flex-col overflow-auto">
    <SheetHeader>
      <SheetTitle title="Group Class">{{ groupDetails.class?.name ?? "Group" }}</SheetTitle>
      <SheetTitle title="Name">{{groupDetails.name}}</SheetTitle>
      <SheetDescription>
        <Copyable :text="groupDetails.uuid">{{groupDetails.uuid}}</Copyable>
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
          <MembersTab :group="groupDetails" @objectClick="e => $emit('objectClick', e)" />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsTab :group="groupDetails" @objectClick="e => $emit('objectClick', e)" />
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
import {useGroupStore} from "@store/useGroupStore.js";
import Copyable from "@components/Copyable.vue";

export default {
  name: 'GroupManagementSidebar',

  setup () {
    return {
      g: useGroupStore(),
    }
  },

  emits: ['objectClick'],

  components: {
    Copyable,
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

  watch: {
    group: {
      async handler(newGroup) {
        if (!newGroup) {
          this.groupDetails = null
          return;
        }
        this.groupDetails = await this.g.getGroup(this.group.uuid)
      },
      immediate: true,
    },
  },

  props: {
    group: {
      type: Object,
      default: null,
    },
  },

  data() {
    return {
      groupDetails: null,
    }
  }
}
</script>

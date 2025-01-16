<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Sheet :open="selectedPrincipal !== null" @update:open="e => !e ? selectedPrincipal = null : null">
    <PrincipalManagementSidebar :principal="selectedPrincipal"></PrincipalManagementSidebar>
  </Sheet>
  <Sheet :open="selectedGroup !== null" @update:open="e => !e ? selectedGroup = null : null">
    <GroupManagementSidebar :group="selectedGroup"></GroupManagementSidebar>
  </Sheet>
  <Tabs default-value="principals">
    <TabsList class="mb-6">
      <TabsTrigger value="principals">
        Principals
      </TabsTrigger>
      <TabsTrigger value="groups">
        Groups
      </TabsTrigger>
      <TabsTrigger value="permissions">
        Permissions
      </TabsTrigger>
    </TabsList>
    <TabsContent value="principals">
      <PrincipalList @rowClick="e => selectedPrincipal = e.original"/>
    </TabsContent>
    <TabsContent value="groups">
      <GroupList @rowClick="e => selectedGroup = e.original"/>
    </TabsContent>
    <TabsContent value="permissions">
      <PermissionList @rowClick="e => {console.log('Selected Permission', e.original); selectedPermission = e.original}"/>
    </TabsContent>
  </Tabs>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { defineAsyncComponent } from 'vue'
import { Button } from '@components/ui/button/index.js'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { useGroupStore } from '@store/useGroupStore.js'
import PrincipalList from './PrincipalList.vue'
import GroupList from './GroupList.vue'
import PermissionList from '@pages/AccessControl/Permissions/PermissionList.vue'
import { usePermissionStore } from '@store/usePermissionStore.js'

export default {
  name: 'AccessControl',

  setup () {
    return {
      s: useServiceClientStore(),
      p: usePrincipalStore(),
      ps: usePermissionStore(),
      g: useGroupStore(),
    }
  },

  components: {
    PermissionList,
    Button,
    DataTable,
    Skeleton,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    PrincipalManagementSidebar: defineAsyncComponent(() => import('./Principals/PrincipalManagementSidebar.vue')),
    GroupManagementSidebar: defineAsyncComponent(() => import('./Groups/GroupManagementSidebar.vue')),
    PrincipalList,
    GroupList,
  },

  async mounted () {
    // Load the principals and the groups - we need them almost
    // everywhere and pretty much immediately. An alternative would be
    // to lazy load these when the table that is displaying them is
    // loaded, but they (especially in the case of groups) may be needed
    // in other tables so this is cleaner.
    this.p.fetch()
    this.g.fetch()
    this.ps.fetch()
  },

  data () {
    return {
      selectedPrincipal: null,
      selectedGroup: null,
      selectedPermission: null
    }
  },
}
</script>

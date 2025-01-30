<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Sheet :open="selectedPrincipal !== null" @update:open="e => !e ? selectedPrincipal = null : null">
    <PrincipalManagementSidebar :principal="selectedPrincipal" @objectClick="e => objectClicked(e.original)"></PrincipalManagementSidebar>
  </Sheet>
  <Sheet :open="selectedGroup !== null" @update:open="e => !e ? selectedGroup = null : null">
    <GroupManagementSidebar :group="selectedGroup" @objectClick="e => objectClicked(e.original)"></GroupManagementSidebar>
  </Sheet>
  <Sheet :open="selectedPermission !== null" @update:open="e => !e ? selectedPermission = null : null">
    <PermissionManagementSidebar :permission="selectedPermission" @objectClick="e => objectClicked(e.original)"></PermissionManagementSidebar>
  </Sheet>
  <Tabs @update:modelValue="e => currentTab = e" :default-value="defaultTab">
    <div class="flex items-center justify-between gap-2">
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
      <LinkUserDialog v-if="currentTab"/>
    </div>
    <TabsContent value="principals">
      <PrincipalList @rowClick="e => objectClicked(e.original)"/>
    </TabsContent>
    <TabsContent value="groups">
      <GroupList @rowClick="e => objectClicked(e.original)"/>
    </TabsContent>
    <TabsContent value="permissions">
      <PermissionList @rowClick="e => objectClicked(e.original)"/>
    </TabsContent>
  </Tabs>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Sheet } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { defineAsyncComponent } from 'vue'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { useGroupStore } from '@store/useGroupStore.js'
import PrincipalList from './PrincipalList.vue'
import GroupList from './GroupList.vue'
import PermissionList from '@pages/AccessControl/Permissions/PermissionList.vue'
import { usePermissionStore } from '@store/usePermissionStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import LinkUserDialog from '@pages/AccessControl/LinkUserDialog.vue'

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
    LinkUserDialog,
    PermissionList,
    Sheet,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    PrincipalManagementSidebar: defineAsyncComponent(() => import('./Principals/PrincipalManagementSidebar.vue')),
    GroupManagementSidebar: defineAsyncComponent(() => import('./Groups/GroupManagementSidebar.vue')),
    PermissionManagementSidebar: defineAsyncComponent(() => import('./Permissions/PermissionManagementSidebar.vue')),
    PrincipalList,
    GroupList,
  },

  methods: {
    async objectClicked (object) {
      // Get type of object
      let classUUID = "";
      if (object.class) {
        classUUID = object.class.uuid
      } else {
        let principalObjectResponse = await this.s.client.ConfigDB.get_config(UUIDs.App.Registration, object.uuid);
        classUUID = principalObjectResponse.class
      }

      switch (classUUID) {
        case UUIDs.Class.Permission:
          this.selectPermission(object)
          break;
        case UUIDs.Class.PermGroup:
        case UUIDs.Class.GitRepoGroup:
        case "f1fabdd1-de90-4399-b3da-ccf6c2b2c08b": // User Group
        case "1c567e3c-5519-4418-8682-6086f22fbc13": // Client Role
        case "b419cbc2-ab0f-4311-bd9e-f0591f7e88cb": // Service Requirement
          if (!object.members) {
            object.members = await this.g.getMembers(object)
          }
          this.selectGroup(object)
          break;
        case "e463b4ae-a322-46cc-8976-4ba76838e908": // Service Account
        case "8b3e8f35-78e5-4f93-bf21-7238bcb2ba9d": // User Account
        case "97756c9a-38e6-4238-b78c-3df6f227a6c9": // Edge Cluster Account
        case "00da3c0b-f62b-4761-a689-39ad0c33f864": // Cell Gateway
          this.selectPrincipal(object)
          break;
        // TODO: Likely some missing UUIDs here. Git Repo??
      }
    },
    selectPrincipal (principal) {
      this.selectedGroup = null
      this.selectedPermission = null
      if (principal.kerberos) {
        this.selectedPrincipal = principal
      } else {
        this.selectedPrincipal = this.p.data.find(p => p.uuid === principal.uuid)
      }
    },
    selectGroup (group) {
      this.selectedPrincipal = null
      this.selectedPermission = null
      this.selectedGroup = group
    },
    selectPermission (permission) {
      this.selectedPrincipal = null
      this.selectedGroup = null
      this.selectedPermission = permission
    }
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

    const defaultTab = 'principals'

    return {
      defaultTab: defaultTab,
      currentTab: defaultTab,
      selectedPrincipal: null,
      selectedGroup: null,
      selectedPermission: null,
    }
  },
}
</script>

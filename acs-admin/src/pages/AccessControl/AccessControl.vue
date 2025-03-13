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
      <LinkUserDialog v-if="currentTab==='principals'"/>
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
import {useGrantStore} from "@store/useGrantStore.js";

export default {
  name: 'AccessControl',

  setup () {
    return {
      s: useServiceClientStore(),
      p: usePrincipalStore(),
      ps: usePermissionStore(),
      g: useGroupStore(),
      grants: useGrantStore(),
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
        // TODO: Check if the uuid is a subclass of UUIDs.Class.Permission
        case UUIDs.Class.Permission:
        case "a637134a-d06b-41e7-ad86-4bf62fde914a": // MQTT
        case "9e07fd33-6400-4662-92c4-4dff1f61f990": // Cluster manager
        case "c0c55c78-116e-4526-8ff4-e4595251f76c": // Git
        case "50b727d4-3faa-40dc-b347-01c99a226c58": // Auth
        case "58b5da47-d098-44f7-8c1d-6e4bd800e718": // Directory
        case "9584ee09-a35a-4278-bc13-21a8be1f007c": // CmdEsc
        case "c43c7157-a50b-4d2a-ac1a-86ff8e8e88c1": // ConfigDB
          this.selectPermission(object)
          break;
        // TODO: Check if the uuid is a subclass of Role or Composite Permission
        case UUIDs.Class.PermGroup:
        case UUIDs.Class.GitRepoGroup:
        case "f1fabdd1-de90-4399-b3da-ccf6c2b2c08b": // User Group
        case "b2053a3e-bdf8-11ef-9423-771a19e4a8a4": // Client role
        case "b419cbc2-ab0f-4311-bd9e-f0591f7e88cb": // Service role
        case "3ba1d68e-ccf5-11ef-82d9-ef32470538b1": // Edge role
        case "1c567e3c-5519-4418-8682-6086f22fbc13": // Composite permission
          if (!object.members) {
            object.members = await this.g.getMembers(object)
          }
          this.selectGroup(object)
          break;
        // TODO: Check if the uuid is a subclass of Principal
        case "e463b4ae-a322-46cc-8976-4ba76838e908": // Central service
        case "8b3e8f35-78e5-4f93-bf21-7238bcb2ba9d": // Human user
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
    this.grants.fetch()
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

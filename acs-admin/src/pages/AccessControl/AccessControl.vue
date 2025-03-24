<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Sheet :open="selectedPrincipal !== null" @update:open="e => !e ? objectClicked({}) : null">
    <PrincipalManagementSidebar :principal="selectedPrincipal" @objectClick="e => objectClicked(e.original)"></PrincipalManagementSidebar>
  </Sheet>
  <Sheet :open="selectedGroup !== null" @update:open="e => !e ? objectClicked({}) : null">
    <GroupManagementSidebar :group="selectedGroup" @objectClick="e => objectClicked(e.original)"></GroupManagementSidebar>
  </Sheet>
  <Sheet :open="selectedPermission !== null" @update:open="e => !e ? objectClicked({}) : null">
    <PermissionManagementSidebar :permission="selectedPermission" @objectClick="e => objectClicked(e.original)"></PermissionManagementSidebar>
  </Sheet>
  <Tabs @update:modelValue="changeTab" :default-value="activeTab">
    <div class="flex items-center justify-between gap-2 mb-6">
      <div class="flex gap-2 items-center">
        <TabsList>
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
        <div v-if="p.loading || ps.loading || g.loading || grants.loading"><i class="fa-solid fa-circle-notch animate-spin"></i></div>
      </div>
      <LinkUserDialog v-if="activeTab==='principals'"/>
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
import PrincipalList from './Principals/PrincipalList.vue'
import GroupList from './Groups/GroupList.vue'
import PermissionList from '@pages/AccessControl/Permissions/PermissionList.vue'
import { usePermissionStore } from '@store/usePermissionStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import LinkUserDialog from '@pages/AccessControl/LinkUserDialog.vue'
import {useGrantStore} from "@store/useGrantStore.js";
import {useRoute, useRouter} from "vue-router";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {useObjectStore} from "@store/useObjectStore.js";

export default {
  name: 'AccessControl',

  setup () {
    return {
      s: useServiceClientStore(),
      p: usePrincipalStore(),
      ps: usePermissionStore(),
      g: useGroupStore(),
      grants: useGrantStore(),
      obj: useObjectStore(),
      router: useRouter(),
      route: useRoute()
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
      if (object.uuid) {
        this.router.push({ path: `/access-control/${this.activeTab}/${object.uuid}` })
      } else {
        this.router.push({ path: `/access-control/${this.activeTab}` })
      }
    },
    async uuidSelected (uuid) {
      await serviceClientReady()
      await this.objectSelected({uuid})
    },
    async objectSelected (object) {
      if (await this.s.client.ConfigDB.class_has_member("ac0d5288-6136-4ced-a372-325fbbcdd70d", object.uuid) ||
          await this.s.client.ConfigDB.class_has_member("c0157038-ccff-11ef-a4db-63c6212e998f", object.uuid)
      ) {
        // Permission Group
        // Principal Group
        // Treat this as a group
        const group = this.g.data.find(g => g.uuid === object.uuid)
        if (!group) {
          console.error("Group not found in the store", object.uuid)
          this.objectDeselect()
          return
        }
        this.selectGroup(group)
      } else if (await this.s.client.ConfigDB.class_has_member(UUIDs.Class.Permission, object.uuid)) {
        // Permission
        const permission = this.ps.data.find(p => p.uuid === object.uuid)
        if (!permission) {
          console.error("Permission not found in the store", object.uuid)
          this.objectDeselect()
          return
        }
        this.selectPermission(permission)
      } else if (await this.s.client.ConfigDB.class_has_member("11614546-b6d7-11ef-aebd-8fbb45451d7c", object.uuid)) {
        // Principal
        const principal = this.p.data.find(p => p.uuid === object.uuid)
        if (!principal) {
          console.error("Principal not found in the store", object.uuid)
          this.objectDeselect()
          return
        }
        this.selectPrincipal(principal)
      }
    },
    objectDeselect() {
      this.router.push({ path: `/access-control/${this.activeTab}` })
    },
    selectPrincipal (principal) {
      this.selectedGroup = null
      this.selectedPermission = null
      this.selectedPrincipal = principal
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
    },
    changeTab (newTab) {
      this.router.push({ path: `/access-control/${newTab}` })
    },
  },

  watch: {
    activeTab: {
      handler (newTab) {
        if (!newTab) {
          this.router.replace({path: `/access-control/principals`})
        }
      },
      immediate: true,
    },
    activeSelection: {
      handler (newSelection) {
        if (!newSelection) {
          this.selectedPrincipal = null;
          this.selectedGroup = null;
          this.selectedPermission = null;
          // this.router.replace({path: `/access-control/principals`})
          return;
        }
        this.uuidSelected(newSelection)
      },
      immediate: true,
    },
  },

  computed: {
    activeTab () {
      return this.route.params.tab || 'principals'
    },
    activeSelection () {
      return this.route.params.selected || null
    }
  },

  async mounted () {
    // Load the principals and the groups - we need them almost
    // everywhere and pretty much immediately. An alternative would be
    // to lazy load these when the table that is displaying them is
    // loaded, but they (especially in the case of groups) may be needed
    // in other tables so this is cleaner.
    this.ps.fetch()
    this.grants.fetch()

    // Start a reactive fetch via the notify interface
    this.obj.start()
    this.p.start()
    this.g.start()
  },

  unmounted () {
    this.g.stop()
    this.p.stop()
    this.obj.stop()
  },

  data () {
    return {
      selectedPrincipal: null,
      selectedGroup: null,
      selectedPermission: null,
    }
  },
}
</script>

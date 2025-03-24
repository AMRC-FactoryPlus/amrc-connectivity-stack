<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Tabs @update:modelValue="changeTab" :default-value="activeTab">
    <div class="flex items-center justify-between gap-2 mb-6">
      <div class="flex gap-2 items-center">
        <TabsList>
          <TabsTrigger value="applications">
            Applications
          </TabsTrigger>
          <TabsTrigger value="objects">
            Objects
          </TabsTrigger>
          <TabsTrigger value="json">
            JSON Dumps
          </TabsTrigger>
        </TabsList>
        <div v-if="p.loading || ps.loading || g.loading || grants.loading"><i class="fa-solid fa-circle-notch animate-spin"></i></div>
      </div>
      <Button v-if="activeTab==='applications'">Add Application</Button>
      <Button v-if="activeTab==='objects'">Add Object</Button>
    </div>
    <TabsContent value="applications">
      <ApplicationList @rowClick="e => objectClicked(e.original)"></ApplicationList>
    </TabsContent>
    <TabsContent value="objects">
      Objects
    </TabsContent>
    <TabsContent value="json">
      JSON
    </TabsContent>
  </Tabs>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { defineAsyncComponent } from 'vue'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { useGroupStore } from '@store/useGroupStore.js'
import PermissionList from '@pages/AccessControl/Permissions/PermissionList.vue'
import { usePermissionStore } from '@store/usePermissionStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import LinkUserDialog from '@pages/AccessControl/LinkUserDialog.vue'
import {useGrantStore} from "@store/useGrantStore.js";
import {useRoute, useRouter} from "vue-router";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {useObjectStore} from "@store/useObjectStore.js";
import ApplicationList from "@pages/ConfigDB/Applications/ApplicationList.vue";
import PrincipalList from "@pages/AccessControl/Principals/PrincipalList.vue";

export default {
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
    PrincipalList,
    ApplicationList,
    LinkUserDialog,
    PermissionList,
    Sheet,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Button,
  },

  methods: {
    async objectClicked (object) {
      if (object.uuid) {
        this.router.push({ path: `/configdb/${this.activeTab}/${object.uuid}` })
      } else {
        this.router.push({ path: `/configdb/${this.activeTab}` })
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
      this.router.push({ path: `/configdb/${this.activeTab}` })
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
      this.router.push({ path: `/configdb/${newTab}` })
    },
  },

  watch: {
    activeTab: {
      handler (newTab) {
        if (!newTab) {
          this.router.replace({path: `/configdb/applications`})
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
      return this.route.params.tab || 'applications'
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
    this.p.fetch()
    this.g.fetch()
    this.ps.fetch()
    this.grants.fetch()
    this.obj.fetch()
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

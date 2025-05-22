<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Tabs @update:modelValue="changeTab" :default-value="activeTab">
    <TabsContent value="objects">
      <ObjectList @rowClick="e => objectClicked(e.original)">
        <template #toolbar-right>
          <CreateObjectDialog v-if="activeTab==='objects'" :objs="obj.data" />
        </template>
        <TabsList>
          <TabsTrigger value="applications">
            Applications
          </TabsTrigger>
          <TabsTrigger value="objects">
            Objects
          </TabsTrigger>
        </TabsList>
      </ObjectList>
    </TabsContent>
    <TabsContent value="applications">
      <ApplicationList @rowClick="e => objectClicked(e.original)">
        <template #toolbar-right>
          <Button title="Currently not implemented" disabled v-if="activeTab==='applications'" class="gap-2">
            <i class="fa-solid fa-plus"></i>
            <span>Create Application</span>
          </Button>
        </template>
        <TabsList>
          <TabsTrigger value="applications">
            Applications
          </TabsTrigger>
          <TabsTrigger value="objects">
            Objects
          </TabsTrigger>
        </TabsList>
      </ApplicationList>
    </TabsContent>
  </Tabs>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import PermissionList from '@pages/AccessControl/Permissions/PermissionList.vue'
import { UUIDs } from '@amrc-factoryplus/service-client'
import LinkUserDialog from '@pages/AccessControl/LinkUserDialog.vue'
import {useRoute, useRouter} from "vue-router";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {useObjectStore} from "@store/useObjectStore.js";
import ApplicationList from "@pages/ConfigDB/Applications/ApplicationList.vue";
import ObjectList from "@pages/ConfigDB/Objects/ObjectList.vue";
import PrincipalList from "@pages/AccessControl/Principals/PrincipalList.vue";
import {useApplicationStore} from "@store/useApplicationStore.js";
import CreateObjectDialog from "@pages/ConfigDB/CreateObjectDialog.vue";

export default {
  setup () {
    return {
      s: useServiceClientStore(),
      obj: useObjectStore(),
      app: useApplicationStore(),
      router: useRouter(),
      route: useRoute(),
    }
  },

  components: {
    CreateObjectDialog,
    PrincipalList,
    ApplicationList,
    ObjectList,
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
    },

    objectsLoading () {
      return !this.obj.ready || this.obj.loading
    },

    applicationsLoading () {
      return !this.app.ready || this.app.loading
    },
  },

  async mounted () {
    // Start a reactive fetch via the notify interface
    this.obj.start()
    this.app.start()
  },

  unmounted () {
    this.obj.stop()
    this.app.stop()
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

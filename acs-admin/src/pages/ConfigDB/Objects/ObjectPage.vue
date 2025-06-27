<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->
<template>
  <Skeleton v-if="!obj.ready || d.loading || m.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <div v-else class="flex h-full">
    <!-- Dialogs -->
    <ObjectSelector
        v-model="ownerToChange"
        v-model:open="showingOwnerDialog"
        :store-data="availableOwners"
        :multiSelect="false"
        title="Select Owner"
        subtitle="Select the principal who should own this object"
        column1-header="Name"
        column1-main-key="name"
        column1-sub-key="uuid"
        column2-header="Class"
        column2-main-key="class.name"
        column2-sub-key="class.uuid"
    />
    <!-- Main content -->
    <div class="flex flex-col gap-4 pr-4 flex-1 overflow-auto">
      <div>
        <RouterLink  :to="`/configdb/objects`">
          <Button size="sm" class="gap-2">
            <i class="fa-solid fa-arrow-left"></i>
            Back
          </Button>
        </RouterLink>
      </div>
      <DataTable
          :data="isSubclassOf"
          :default-sort="initialSort"
          :columns="subclassOfColumns"
          :filters="[]"
          @row-click="e => objectClicked(e.original)"
          v-if="object.rank > 0">
        <template #toolbar-left>
          <div class="flex items-center justify-start gap-2 pl-1">
            <i :class="`fa-fw fa-solid fa-sitemap`"></i>
            <div class="font-semibold text-xl">Subclass Of</div>
          </div>
        </template>
        <template #toolbar-right>
          <div class="flex justify-between items-end flex-grow">
            <ObjectSelector
                v-model="subclassOfToAdd"
                :store-data="availableSubclassOf"
                title="Select Classifications"
                subtitle="Select the objects which this object should become a subclass of"
                column1-header="Name"
                column1-main-key="name"
                column1-sub-key="uuid"
                column2-header="Class"
                column2-main-key="class.name"
                column2-sub-key="class.uuid"
            >
              <Button size="sm" class="gap-2">
                <i class="fa-solid fa-plus"></i>
                Add Classification
              </Button>
            </ObjectSelector>
          </div>
        </template>
      </DataTable>
      <DataTable
          :data="isMemberOf"
          :default-sort="initialSort"
          :columns="memberOfColumns"
          :filters="[]"
          @row-click="e => objectClicked(e.original)">
        <template #toolbar-left>
          <div class="flex items-center justify-start gap-2 pl-1">
            <i :class="`fa-fw fa-solid fa-users`"></i>
            <div class="font-semibold text-xl">Member Of</div>
          </div>
        </template>
        <template #toolbar-right>
          <div class="flex justify-between items-end flex-grow">
            <ObjectSelector
                v-model="membershipsToAdd"
                :store-data="availableMemberships"
                title="Select Memberships"
                subtitle="Select the objects which this object should become a member of"
                column1-header="Name"
                column1-main-key="name"
                column1-sub-key="uuid"
                column2-header="Class"
                column2-main-key="class.name"
                column2-sub-key="class.uuid"
            >
              <Button size="sm" class="gap-2">
                <i class="fa-solid fa-plus"></i>
                Add Membership
              </Button>
            </ObjectSelector>
          </div>
        </template>
      </DataTable>
      <DataTable class="mt-4"
          :data="subclasses"
          :default-sort="initialSort"
          :columns="subclassColumns"
          :filters="[]"
          @row-click="e => objectClicked(e.original)"
          v-if="object.rank > 0">
        <template #toolbar-left>
          <div class="flex items-center justify-start gap-2 pl-1">
            <i :class="`fa-fw fa-solid fa-sitemap`"></i>
            <div class="font-semibold text-xl">Subclasses</div>
          </div>
        </template>
        <template #toolbar-right>
          <div class="flex justify-between items-end flex-grow">
            <ObjectSelector
                v-model="subclassesToAdd"
                :store-data="availableSubclasses"
                title="Select new Subclasses"
                subtitle="Select the objects which become a subclass of this object"
                column1-header="Name"
                column1-main-key="name"
                column1-sub-key="uuid"
                column2-header="Class"
                column2-main-key="class.name"
                column2-sub-key="class.uuid"
            >
              <Button size="sm" class="gap-2">
                <i class="fa-solid fa-plus"></i>
                Add Subclass
              </Button>
            </ObjectSelector>
          </div>
        </template>
      </DataTable>
      <DataTable class="mt-4"
          :data="members"
          :default-sort="initialSort"
          :columns="membersColumns"
          :filters="[]"
          @row-click="e => objectClicked(e.original)"
          v-if="object.rank > 0">
        <template #toolbar-left>
          <div class="flex items-center justify-start gap-2 pl-1">
            <i class="fa-fw fa-solid fa-users"></i>
            <div class="font-semibold text-xl">Members</div>
          </div>
        </template>
        <template #toolbar-right>
          <div class="flex justify-between items-end flex-grow">
            <ObjectSelector
                v-model="membersToAdd"
                :store-data="availableMembers"
                title="Select new Members"
                subtitle="Select the objects which become a member of this object"
                column1-header="Name"
                column1-main-key="name"
                column1-sub-key="uuid"
                column2-header="Class"
                column2-main-key="class.name"
                column2-sub-key="class.uuid"
            >
              <Button size="sm" class="gap-2">
                <i class="fa-solid fa-plus"></i>
                Add Member
              </Button>
            </ObjectSelector>
          </div>
        </template>
      </DataTable>
      <div v-if="object.rank === 0" class="text-center text-gray-400">Objects of rank 0 cannot have members or subclasses, nor can they be subclasses.</div>
    </div>

    <!-- Sidebar -->
    <div class="w-96 flex-shrink-0 border-l -my-4 -mr-4">
      <div class="flex items-center justify-start border-b gap-2 p-4">
        <i :class="`fa-fw fa-solid fa-cube`"></i>
        <div class="font-semibold text-xl">{{object?.name ?? ''}}</div>
      </div>
      <div class="space-y-4 p-4">
        <SidebarDetail
            icon="key"
            label="Node UUID"
            :value="object?.uuid ?? ''"
        />
        <SidebarDetail
            icon="ranking-star"
            label="Rank"
            :value="object?.rank.toString() ?? ''"
        />
        <div class="pt-2">
          <RouterLink :to="`/configdb/applications/${UUIDs.App.Info}/${object.uuid}`">
            <Button title="Go to object information" size="xs" class="flex gap-2 text-gray-500" variant="ghost">
              <i class="fa-solid fa-external-link"></i>
              Go to object information entry
            </Button>
          </RouterLink>
        </div>
      </div>
      <div class="font-semibold text-lg p-4 border-b">Class Information</div>
      <div class="space-y-4 p-4">
        <SidebarDetail
            icon="tag"
            label="Name"
            :value="object?.class?.name ?? ''"
        />
        <SidebarDetail
            icon="key"
            label="UUID"
            :value="object?.class?.uuid ?? ''"
        />
        <div class="pt-2">
          <RouterLink :to="`/configdb/applications/${UUIDs.App.Registration}/${object.uuid}`">
            <Button title="Go to object registration" size="xs" class="flex gap-2 text-gray-500" variant="ghost">
              <i class="fa-solid fa-external-link"></i>
              Go to object registration entry
            </Button>
          </RouterLink>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2 p-4 border-b">
        <div class="font-semibold text-lg">Owner</div>
        <Button title="Change owner"
            @click="showOwnerDialog"
            size="sm"
            variant="ghost"
            class="flex items-center justify-center gap-2"
        >
          <i class="fa-solid fa-sync text-sm"></i>
        </Button>
      </div>
      <div class="space-y-4 p-4">
        <SidebarDetail icon="tag" label="Name" :value="object.owner.name"/>
        <SidebarDetail icon="key" label="UUID" :value="object.owner.uuid"/>
      </div>
    </div>
  </div>

</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { memberOfColumns } from './TableData/objectMemberOfListColumns.ts'
import { membersColumns } from './TableData/objectMembersListColumns.ts'
import { subclassOfColumns } from './TableData/objectSubclassOfListColumns.ts'
import { subclassColumns } from './TableData/objectSubclassListColumns.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card/index.js'
import { useObjectStore } from '@store/useObjectStore.js'
import { useRoute, useRouter } from 'vue-router'
import { useDirectStore } from '@store/useDirectStore.js'
import { Button } from '@components/ui/button/index.js'
import Copyable from '@components/Copyable.vue'
import { useMemberStore } from '@store/useMemberStore.js'
import { defineAsyncComponent } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { toast } from 'vue-sonner'
import SidebarDetail from '@components/SidebarDetail.vue'
import {UUIDs} from "@amrc-factoryplus/service-client";

export default {
  emits: ['rowClick'],

  setup () {
    return {
      memberOfColumns,
      membersColumns,
      subclassOfColumns,
      subclassColumns,
      s: useServiceClientStore(),
      obj: useObjectStore(),
      d: useDirectStore(),
      m: useMemberStore(),
      route: useRoute(),
      router: useRouter(),
      UUIDs,
    }
  },

  components: {
    Copyable,
    CardDescription, CardContent, CardHeader, CardTitle, Button,
    Card,
    Skeleton,
    DataTable,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
    SidebarDetail,
  },

  computed: {
    object () {
      return this.obj.data.find(o => o.uuid === this.route.params.object)
    },
    relationships () {
      const direct = this.d.data.find(o => o.uuid === this.route.params.object)
      const directMembers = direct?.directMembers ?? []
      const directSubclasses = direct?.directSubclasses ?? []
      return {
        uuid: this.route.params.object,
        directMembers,
        directSubclasses,
      }
    },
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
    isSubclassOf () {
      let subclassOf = []
      let subclassesToLookup = [this.object.uuid]
      do {
        // Try to find all the direct subclass links that refer to any of the uuids in the lookup array
        const subclassLookup = this.d.data.filter(group => group.directSubclasses.some(g => subclassesToLookup.includes(g)))
        const objLookup = subclassLookup.map(subclass => this.obj.data.find(o => o.uuid === subclass.uuid))
        subclassOf = subclassOf.concat(objLookup)
        subclassesToLookup = objLookup.map(s => s.uuid)
      } while (subclassesToLookup.length > 0)
      return subclassOf.map(o => ({...o, originalObject: this.object}))
    },
    isMemberOf () {
      // BUG: This isn't refreshing when this.r.data changes???
      const directMemberships = this.d.data.filter(group => group.directMembers.includes(this.object.uuid)).map(m => m.uuid)
      const directMembershipObjs = directMemberships.map(membership => {
        const obj = this.obj.data.find(o => o.uuid === membership)
        return {
          ...obj,
          direct: "Direct"
        }
      })
      const indirectMemberships = this.m.data.filter(group => group.members.includes(this.object.uuid) && !directMemberships.includes(group.uuid)).map(m => m.uuid)
      const indirectMembershipObjs = indirectMemberships.map(membership => {
        const obj = this.obj.data.find(o => o.uuid === membership)
        return {
          ...obj,
          direct: "Indirect"
        }
      })
      return directMembershipObjs.concat(indirectMembershipObjs).map(o => ({...o, originalObject: this.object}))
    },
    members () {
      const directMembers = this.relationships?.directMembers ?? []
      const dmObjects = directMembers.map(mUUID => {
        const obj = this.obj.data.find(o => o.uuid === mUUID)
        return {
          ...obj,
          direct: "Direct"
        }
      })
      // TODO: This can be refactored to subscribe to the current member entries within this component, rather than going to the group store
      const indirectMembers = this.m.data.find(g => g.uuid === this.object.uuid)?.members.filter(mUUID => !directMembers.includes(mUUID)) ?? []
      const imObjects = indirectMembers.map(mUUID => {
        const obj = this.obj.data.find(o => o.uuid === mUUID)
        return {
          ...obj,
          direct: "Indirect"
        }
      })
      return dmObjects.concat(imObjects).map(o => ({...o, originalObject: this.object}))
    },
    subclasses () {
      const s = this.relationships?.directSubclasses ?? []
      return s.map(sUUID => this.obj.data.find(o => o.uuid === sUUID)).map(o => ({...o, originalObject: this.object}))
    },
    availableSubclassOf () {
      const subclassOfUUIDs = this.isSubclassOf.map(m => m.uuid)
      return this.obj.data  // All objects
        .filter(o => o.rank === this.object.rank) // All objects of the same rank
        .filter(o => !subclassOfUUIDs.includes(o.uuid)) // Objects of the same rank which are we are note already a subclass of
    },
    availableMemberships () {
      const directMemberships = this.d.data.filter(group => group.directMembers.includes(this.object.uuid)).map(m => m.uuid)
      return this.obj.data  // All objects
        .filter(o => o.rank === this.object.rank+1) // All objects of a rank above
        .filter(o => !directMemberships.includes(o.uuid)) // Objects of a rank above which it's not already a direct member of
    },
    availableSubclasses () {
      const subclasses = this.relationships?.directSubclasses ?? []
      return this.obj.data  // All objects
        .filter(o => o.rank === this.object.rank) // All objects of the same rank
        .filter(o => !subclasses.includes(o.uuid)) // Objects of the same rank which are not already a subclass
    },
    availableMembers () {
      const directMembers = this.relationships?.directMembers ?? []
      return this.obj.data  // All objects
        .filter(o => o.rank === this.object.rank-1) // All objects of a rank below
        .filter(o => !directMembers.includes(o.uuid)) // Objects of a rank below which are not already a direct member
    },
    availableOwners () {
      const princs = this.m.data.find(c => c.uuid == UUIDs.Class.Principal);
      const owners = new Set(princs?.members ?? []);
      owners.add(UUIDs.Special.Unowned);
      return this.obj.data.filter(o => owners.has(o.uuid));
    },
  },

  watch: {
    subclassOfToAdd: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      for (const obj of val) {
        await this.addSubclassOf(obj)
      }

      await this.updateData();
    },
    membershipsToAdd: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      for (const obj of val) {
        await this.addMembership(obj)
      }

      await this.updateData();
    },
    subclassesToAdd: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      for (const obj of val) {
        await this.addSubclass(obj)
      }

      await this.updateData();
    },
    membersToAdd: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      for (const obj of val) {
        await this.addMember(obj)
      }

      await this.updateData();
    },
    ownerToChange: async function(val, oldVal) {
      if (!val.length) return;
      await this.changeOwner(val[0]);
    },
  },

  methods: {
    async objectClicked (object) {
      if (object.uuid) {
        this.router.push({ path: `/configdb/objects/${object.uuid}` })
      } else {
        this.router.push({ path: `/configdb/objects` })
      }
    },
    async addSubclassOf (group) {
      const client = this.s.client
      try {
        await client.ConfigDB.class_add_subclass(group.uuid, this.object.uuid)
        toast.success(`${this.object.name} has been classified as ${group.name}`)
      } catch (err) {
        toast.error(`Unable to classify ${this.object.name} as ${group.name}`)
        console.error(`Unable to classify ${this.object.name} as ${group.name}`, err)
      }
    },
    async addMembership (group) {
      const client = this.s.client
      try {
        await client.ConfigDB.class_add_member(group.uuid, this.object.uuid)
        toast.success(`${this.object.name} has been added to ${group.name}`)
      } catch (err) {
        toast.error(`Unable to add ${this.object.name} to ${group.name}`)
        console.error(`Unable to add ${this.object.name} to ${group.name}`, err)
      }
    },
    async addSubclass (member) {
      try {
        await this.s.client.ConfigDB.class_add_subclass(this.object.uuid, member.uuid)
        toast.success(`${member.name} has been classified as ${this.object.name}`)
      } catch (err) {
        toast.error(`Unable to classify ${member.name} as ${this.object.name}`)
        console.error(`Unable to classify ${member.name} as ${this.object.name}`, err)
      }
    },
    async addMember (member) {
      try {
        await this.s.client.ConfigDB.class_add_member(this.object.uuid, member.uuid)
        toast.success(`${member.name} has been added to ${this.object.name}`)
      } catch (err) {
        toast.error(`Unable to add ${member.name} to ${this.object.name}`)
        console.error(`Unable to add ${member.name} to ${this.object.name}`, err)
      }
    },
    showOwnerDialog () { 
      this.showingOwnerDialog = true;
    },
    async changeOwner (owner) {
      try {
        await this.s.client.ConfigDB.patch_config(UUIDs.App.Registration,
          this.object.uuid, "merge", { owner: owner.uuid })
        toast.success(`Owner has been changed to ${owner.name}`)
      } catch (err) {
        toast.error(`Unable to change owner to ${owner.name}`)
        console.error(`Unable to change owner to ${owner.name}`, err)
      }
    },
  },

  data() {
    return {
      subclassOfToAdd: [],
      membershipsToAdd: [],
      subclassesToAdd: [],
      membersToAdd: [],
      ownerToChange: [],
      showingOwnerDialog: false,
    }
  },

  async mounted () {
    /* XXX This will cause us to subscribe and unsubscribe to the
     * complete set of class relations whenever this component is
     * mounted or unmounted. This is slow and hammers the backend more
     * than is needed. If we want the complete class structure
     * client-side these stores should be moved up to a higher-level
     * component; otherwise we would be better off only subscribing to
     * the information we need for this object. */
    this.obj.start()
    this.m.start()
    this.d.start()
  },

  unmounted () {
    this.obj.stop()
    this.m.stop()
    this.d.stop()
  },
}
</script>

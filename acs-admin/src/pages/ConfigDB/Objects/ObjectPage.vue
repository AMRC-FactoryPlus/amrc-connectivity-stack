<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="!obj.ready || r.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <div v-else>
    <div class="flex items-center justify-between">
      <Card>
        <CardHeader class="p-2 pt-0 md:p-4">
          <CardTitle>{{object.name}}</CardTitle>
          <CardDescription>
            <Copyable :text="object.uuid">{{object.uuid}}</Copyable>
          </CardDescription>
        </CardHeader>
        <CardContent class="p-2 pt-0 md:p-4 md:pt-0">
          <div>Rank {{object.rank}}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="p-2 pt-0 md:p-4">
          <CardTitle>Class Info</CardTitle>
          <CardDescription>
          </CardDescription>
        </CardHeader>
        <CardContent class="p-2 pt-0 md:p-4 md:pt-0">
          <RouterLink :to="`/configdb/objects/${object.class.uuid}`" class="font-semibold">{{object.class.name}}</RouterLink>
          <Copyable class="text-slate-500" :text="object.class.uuid">{{object.class.uuid}}</Copyable>
        </CardContent>
      </Card>
    </div>
    <Button class="mt-2" disabled>Add Object of Class</Button>
    <DataTable class="mt-4" :data="isSubclassOf" :default-sort="initialSort" :columns="subclassOfColumns" :filters="[]" @row-click="e => objectClicked(e.original)">
      <template #toolbar-left>
        <div class="flex justify-between items-end flex-grow mr-4">
          <div class="font-semibold">This object is a subclass of:</div>
          <Button disabled>Add Classification</Button>
        </div>
      </template>
    </DataTable>
    <DataTable class="mt-4" :data="isMemberOf" :default-sort="initialSort" :columns="memberOfColumns" :filters="[]" @row-click="e => objectClicked(e.original)">
      <template #toolbar-left>
        <div class="flex justify-between items-end flex-grow mr-4">
          <div class="font-semibold">Is object is a member of:</div>
          <Button disabled>Add Membership</Button>
        </div>
      </template>
    </DataTable>
    <DataTable class="mt-4" :data="subclasses" :default-sort="initialSort" :columns="subclassColumns" :filters="[]" @row-click="e => objectClicked(e.original)">
      <template #toolbar-left>
        <div class="flex justify-between items-end flex-grow mr-4">
          <div class="font-semibold">Direct subclasses of this object:</div>
          <Button disabled>Add a Subclass</Button>
        </div>
      </template>
    </DataTable>
    <DataTable class="mt-4" :data="members" :default-sort="initialSort" :columns="membersColumns" :filters="[]" @row-click="e => objectClicked(e.original)">
      <template #toolbar-left>
        <div class="flex justify-between items-end flex-grow mr-4">
          <div class="font-semibold">Members of this object:</div>
          <Button disabled>Add a Member</Button>
        </div>
      </template>
    </DataTable>
  </div>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { memberOfColumns } from './objectMemberOfListColumns.ts'
import { membersColumns } from './objectMembersListColumns.ts'
import { subclassOfColumns } from './objectSubclassOfListColumns.ts'
import { subclassColumns } from './objectSubclassListColumns.ts'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@components/ui/card/index.js";
import {useObjectStore} from "@store/useObjectStore.js";
import {useGroupStore} from "@store/useGroupStore.js";
import {useRoute, useRouter} from "vue-router";
import {useDirectRelationshipStore} from "@store/useDirectRelationshipStore.js";
import {Button} from "@components/ui/button/index.js";
import Copyable from "@components/Copyable.vue";
import {useMemberStore} from "@store/useMemberStore.js";

export default {
  emits: ['rowClick'],

  setup () {
    return {
      memberOfColumns,
      membersColumns,
      subclassOfColumns,
      subclassColumns,
      obj: useObjectStore(),
      g: useGroupStore(),
      r: useDirectRelationshipStore(),
      m: useMemberStore(),
      route: useRoute(),
      router: useRouter(),
    }
  },

  components: {
    Copyable,
    CardDescription, CardContent, CardHeader, CardTitle, Button,
    Card,
    Skeleton,
    DataTable,
  },

  computed: {
    object () {
      return this.obj.data.find(o => o.uuid === this.route.params.object)
    },
    relationships () {
      return this.r.data.find(o => o.uuid === this.route.params.object)
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
        const subclassLookup = this.r.data.filter(group => group.directSubclasses.some(g => subclassesToLookup.includes(g)))
        const objLookup = subclassLookup.map(subclass => this.obj.data.find(o => o.uuid === subclass.uuid))
        subclassOf = subclassOf.concat(objLookup)
        subclassesToLookup = objLookup.map(s => s.uuid)
      } while (subclassesToLookup.length > 0)
      return subclassOf
    },
    isMemberOf () {
      const directMemberships = this.r.data.filter(group => group.directMembers.includes(this.object.uuid)).map(m => m.uuid)
      const directMembershipObjs = directMemberships.map(membership => {
        const obj = this.obj.data.find(o => o.uuid === membership)
        return {
          ...obj,
          direct: "Direct"
        }
      })
      // TODO: This is incomplete as group store is not exhaustive list of members
      // We can create a group store
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
      return dmObjects.concat(imObjects)
    },
    subclasses () {
      const s = this.relationships?.directSubclasses ?? []
      return s.map(sUUID => this.obj.data.find(o => o.uuid === sUUID))
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
  },

  data() {
    return {
    }
  },

  async mounted () {
    this.obj.start()
    this.g.start()
    this.m.start()

    this.r.fetch()
  },

  unmounted () {
    this.obj.stop()
    this.g.stop()
    this.m.stop()
  },
}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || ps.loading || p.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.members" :columns="columns" :filters="[]" @row-click="e => $emit('objectClick', e)">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Group Memberships</AlertTitle>
            <AlertDescription>
              Manage the membership of this group.
            </AlertDescription>
          </div>
        </div>
      </Alert>
    </template>
    <template #below-toolbar>
      <ObjectSelector
          v-model="membersToAdd"
          :store-data="p.data.filter(principal => !memberUuids.includes(principal.uuid))"
          title="Select Members"
          subtitle="Select principals which should be added to this group"
          column1-header="Name"
          column1-main-key="name"
          column1-sub-key="uuid"
          column2-header="Principal"
          column2-main-key="kerberos"
      >
        <Button>Add Members</Button>
      </ObjectSelector>
    </template>
  </DataTable>
</template>

<script>
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { columns } from './membersColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert/index.js'
import { useGroupStore } from '@store/useGroupStore.js'
import { usePrincipalStore } from "@store/usePrincipalStore.js";
import { useServiceClientStore } from "@store/serviceClientStore.js";
import { UUIDs } from "@amrc-factoryplus/service-client";
import {Button} from "@components/ui/button/index.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@components/ui/dialog/index.js";
import {Label} from "@components/ui/label/index.js";
import {Input} from "@components/ui/input/index.js";
import {toast} from "vue-sonner";
import {defineAsyncComponent, provide} from "vue";
import {usePermissionStore} from "@store/usePermissionStore.js";

export default {
  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePrincipalStore(),
      g: useGroupStore(),
      s: useServiceClientStore(),
      ps: usePermissionStore()
    }
  },

  provide () {
    return {
      groupMembersUpdated: this.updateData
    }
  },

  computed: {
    memberUuids () {
      if (this.g.loading || this.loading) {
        return []
      }

      return this.members.map(m => m.uuid)
    },
    members () {
      // Fill in the member details
      this.loading = true
      const memberList = this.group.members
      const rv = memberList.map((memberUUID) => {
        const lookup = this.p.data.find(e => e.uuid === memberUUID) ?? this.ps.data.find(e => e.uuid === memberUUID)
        if (lookup && (lookup.name || lookup.kerberos)) {
          return {
            ...lookup,
            group: this.group
          }
        }
        return {
          name: "UNKNOWN",
          group: this.group
        }
      })
      this.loading = false
      return rv
    }
  },

  watch: {
    membersToAdd: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      for (const user of val) {
        await this.addMember(user.uuid)
      }
      await this.updateData()
    }
  },

  methods: {
    async updateData () {
      // Make sure we have the latest set of members
      this.s.client.Fetch.cache = "reload"
      await this.g.fetch()
      this.s.client.Fetch.cache = "default"
    },
    async addMember (userUuid) {
      try {
        await this.s.client.ConfigDB.class_add_member(this.group.uuid, userUuid)
        toast.success(`${userUuid} has been added to ${this.group.name}`)
      } catch (err) {
        toast.error(`Unable to add ${userUuid} to ${this.group.name}`)
        console.error(`Unable to add ${userUuid} to ${this.group.name}`, err)
      }
    },
  },

  components: {
    DialogTitle,
    Input,
    Label,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogContent,
    DialogTrigger,
    Dialog,
    Button,
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
  },

  props: {
    group: {
      type: Object,
      required: true,
    },
  },

  data () {
    return {
      loading: false,
      membersToAdd: [],
      addMemberDialogOpen: false
    }
  },

}
</script>
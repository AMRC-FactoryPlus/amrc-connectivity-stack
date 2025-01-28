<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
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
          detail-header="Principal"
          detail-key="kerberos"
          title-header="Name"
          title-key="name"
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

export default {
  name: 'GroupMembership',

  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePrincipalStore(),
      g: useGroupStore(),
      s: useServiceClientStore()
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
    },
    group: {
      handler (val) {
        if (val == null) {
          return
        }

        this.updateData()
      },
      immediate: true,
    },
  },

  methods: {
    async updateData () {
      // Fill in the member details
      this.loading = true
      // Make sure we have the latest set of members
      this.s.client.Fetch.cache = "reload"
      let groupMembersResponse = await this.s.client.Auth.fetch(`authz/group/${this.group.uuid}`)
      this.s.client.Fetch.cache = "default"
      let members = groupMembersResponse[1]
      this.members = await Promise.all(members.map(async (memberUUID) => {
        let obj = this.p.data.find(v => v.uuid === memberUUID)
        if (obj && (obj.name || obj.kerberos)) {
          return {
            uuid: memberUUID,
            name: obj.name ?? obj.kerberos,
            group: this.group
          }
        }
        try {
          let objectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, memberUUID);
          let memberName = objectResponse.name
          return {
            uuid: memberUUID,
            name: memberName,
            group: this.group
          }
        } catch (err) {
          console.error(`Can't read member details`, err)
          return {
            uuid: memberUUID,
            group: this.group
          }
        }
      }))
      this.loading = false
    },
    async addMember (userUuid) {
      try {
        await this.s.client.Auth.add_to_group(this.group.uuid, userUuid)
        toast.success(`${userUuid} has been added to ${this.group.name}`)
      } catch (err) {
        toast.error(`Unable to add ${userUuid} to ${this.group.name}`)
        console.error(`Unable to add ${userUuid} to ${this.group.name}`, err)
      }
    },
  },

  async created() {
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
      members: [],
      membersToAdd: [],
      addMemberDialogOpen: false
    }
  },

}
</script>
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
      <Dialog :open="this.addMemberDialogOpen" @update:open="(isOpen) => this.addMemberDialogOpen = isOpen">
        <DialogTrigger>
          <Button>
            Add Member
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a Member</DialogTitle>
          </DialogHeader>
          <div>
            <Label for="uuid">
              UUID
            </Label>
            <Input id="uuid" v-model="newMember" />
          </div>
          <DialogFooter>
            <DialogClose as-child>
              <Button @click="this.addMember">
                Add
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
import {provide} from "vue";

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

  watch: {
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
      let groupMembersResponse = await this.s.client.Auth.fetch(`authz/group/${this.group.uuid}`)
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

    async addMember () {
      this.s.client.Auth.add_to_group(this.group.uuid, this.newMember).then(async () => {
        toast.success(`${this.newMember} has been added to ${this.group.name}`)
        this.s.client.Fetch.cache = "reload"
        await this.updateData()
        this.s.client.Fetch.cache = "default"
        // TODO: Need to actually update the group member list, not just re-map the existing members
      }).catch((err) => {
        toast.error(`Unable to add ${this.newMember} to ${this.group.name}`)
        console.error(`Unable to add ${this.newMember} to ${this.group.name}`, err)
      })
      this.addMemberDialogOpen = false
    }
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
      newMember: "",
      addMemberDialogOpen: false
    }
  },

}
</script>
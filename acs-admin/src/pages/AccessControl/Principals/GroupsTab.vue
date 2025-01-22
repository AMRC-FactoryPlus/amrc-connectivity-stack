<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.groups" :columns="columns" :filters="[]" @row-click="e => $emit('objectClick', e)">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Group Memberships</AlertTitle>
            <AlertDescription>
              Manage the membership of this Principal's groups.
            </AlertDescription>
          </div>
        </div>
      </Alert>
    </template>
    <template #below-toolbar>
      <Dialog :open="this.groupInsertionDialogOpen" @update:open="(isOpen) => this.groupInsertionDialogOpen = isOpen">
        <DialogTrigger>
          <Button>
            Add to Group
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to a Group</DialogTitle>
          </DialogHeader>
          <div>
            <Label for="uuid">
              UUID
            </Label>
            <Input id="uuid" v-model="groupToAddTo" />
          </div>
          <DialogFooter>
            <DialogClose as-child>
              <Button @click="this.addToGroup">
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
import { columns } from './groupColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useGroupStore } from '@store/useGroupStore.js'
import {Button} from "@components/ui/button/index.js";
import {Dialog, DialogFooter, DialogHeader, DialogTrigger, DialogClose, DialogContent, DialogTitle} from "@components/ui/dialog/index.js";
import {Input} from "@components/ui/input/index.js";
import {toast} from "vue-sonner";
import {Label} from "@components/ui/label/index.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";

export default {
  setup () {
    return {
      columns,
      g: useGroupStore(),
      s: useServiceClientStore()
    }
  },

  provide () {
    return {
      groupMembershipUpdated: this.updateDate
    }
  },

  emits: ['objectClick'],

  components: {
    Label,
    DialogHeader, Input, DialogFooter, Dialog, Button,
    DialogTrigger, DialogClose, DialogContent, DialogTitle,
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
  },

  props: {
    principal: {
      type: Object,
      required: true,
    },
  },

  methods: {
    async addToGroup () {
      this.s.client.Auth.add_to_group(this.groupToAddTo, this.principal.uuid).then(async () => {
        toast.success(`${this.principal.name} has been added to ${this.groupToAddTo}`)
        this.s.client.Fetch.cache = "reload"
        await this.g.fetch()
        this.s.client.Fetch.cache = "default"
        // TODO: Need to actually update the group member list, not just re-map the existing members
      }).catch((err) => {
        toast.error(`Unable to add ${this.principal.name} to ${this.groupToAddTo}`)
        console.error(`Unable to add ${this.principal.name} to ${this.groupToAddTo}`, err)
      })
      this.addMemberDialogOpen = false
    },

    async updateDate() {
      this.s.client.Fetch.cache = "reload"
      await this.g.fetch()
      this.s.client.Fetch.cache = "default"
    }
  },

  computed: {
    groups () {
      if (this.g.loading) {
        return []
      }

      this.loading = false

      return this.g.data.filter(group => {
        return group.members.includes(this.principal.uuid)
      }).map(group => {
        return { ...group, principal: this.principal }
      })
    },
  },

  data () {
    return {
      loading: false,
      groupToAddTo: "",
      groupInsertionDialogOpen: false
    }
  },

}
</script>
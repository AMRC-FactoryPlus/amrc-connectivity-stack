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
      <ObjectSelector
          v-model="groupsToAddTo"
          :store-data="g.data.filter(group => !group.members.includes(principal.uuid))"
          title="Select Groups"
          subtitle="Select groups which which user should be added to"
          column1-header="Name"
          column1-main-key="name"
          column1-sub-key="uuid"
          column2-header="Class"
          column2-main-key="class.name"
          column2-sub-key="class.uuid"
      >
        <Button>Add to Group</Button>
      </ObjectSelector>
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
import {defineAsyncComponent} from "vue";

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
      groupMembershipUpdated: this.updateData
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
    ObjectSelector: defineAsyncComponent(() => import('@components/ObjectSelector/ObjectSelector.vue')),
  },

  props: {
    principal: {
      type: Object,
      required: true,
    },
  },

  watch: {
    groupsToAddTo: async function(val, oldVal) {
      if (!val.length) {
        return
      }

      for (const group of val) {
        await this.addToGroup(group.uuid)
      }
      await this.updateData()
    }
  },

  methods: {
    async addToGroup (groupUuid) {
      try {
        await this.s.client.ConfigDB.class_add_member(groupUuid, this.principal.uuid)
        toast.success(`${this.principal.name} has been added to ${groupUuid}`)
      } catch (err) {
        toast.error(`Unable to add ${this.principal.name} to ${groupUuid}`)
        console.error(`Unable to add ${this.principal.name} to ${groupUuid}`, err)
      }
    },
    async updateData() {
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
      groupsToAddTo: []
    }
  },

}
</script>
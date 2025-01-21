<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <!-- Need to check whether the click is on a permission or a principal -->
<!--  <DataTable v-else :data="this.entries" :columns="columns" :filters="[]" @row-click="e => $emit('objectClick', e)">-->
  <DataTable v-else :data="this.entries" :columns="columns" :filters="[]">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Principal Entries</AlertTitle>
            <AlertDescription>
              Manage the entries that link this permission to principals.
            </AlertDescription>
          </div>
        </div>
      </Alert>
    </template>
  </DataTable>
</template>

<script>
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { columns } from './principalsColumns.ts'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert/index.js'
import { useGroupStore } from '@store/useGroupStore.js'
import { usePrincipalStore } from "@store/usePrincipalStore.js";
import { useServiceClientStore } from "@store/serviceClientStore.js";
import { UUIDs } from "@amrc-factoryplus/service-client";

export default {
  name: 'Principals',

  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePrincipalStore(),
      g: useGroupStore(),
      s: useServiceClientStore()
    }
  },

  watch: {
    permission: {
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
      this.loading = true

      const res = await this.s.client.Auth.fetch(`/authz/ace`)
      if (!Array.isArray(res[1])) {
        return;
      }
      const fullList = res[1];
      const filteredList = fullList.filter(e => e.permission === this.permission.uuid)

      const info = o => this.s.client.ConfigDB.get_config(UUIDs.App.Info, o)
      const classUuid = o => this.s.client.ConfigDB.get_config(UUIDs.App.Registration, o)
      const name = o => info(o).then(v => v?.name)

      const rv = []
      for (const entry of filteredList) {
        const newEntry = {}

        // Get data for the Target
        if (entry.target === UUIDs.Special.Null) {
          newEntry.target = {
            uuid: entry.target,
            name: "Wildcard",
            class: {
              uuid: entry.target,
              name: "Wildcard"
            }
          }
        }

        const targetClass = (await classUuid(entry.target)).class
        const targetClassName = await name(targetClass)
        const targetName     = await name(entry.target)

        newEntry.target = {
          uuid: entry.target,
          name: targetName,
          class: {
            uuid: targetClass,
            name: targetClassName
          }
        }

        // Get data for the Principal
        if (entry.principal === UUIDs.Special.Null) {
          newEntry.principal = {
            uuid: entry.principal,
            name: "Wildcard",
            class: {
              uuid: entry.principal,
              name: "Wildcard"
            }
          }
        }

        const principalClass = (await classUuid(entry.principal)).class
        const principalClassName = await name(principalClass)
        const principalName     = await name(entry.principal)

        newEntry.principal = {
          uuid: entry.principal,
          name: principalName,
          class: {
            uuid: principalClass,
            name: principalClassName
          }
        }

        rv.push(newEntry)
      }

      this.entries = rv
      this.loading = false
    }
  },

  async created() {
  },

  components: {
    DataTable,
    Skeleton,
    Alert,
    AlertTitle,
    AlertDescription,
  },

  props: {
    permission: {
      type: Object,
      required: true,
    },
  },

  data () {
    return {
      loading: false,
      entries: []
    }
  },

}
</script>
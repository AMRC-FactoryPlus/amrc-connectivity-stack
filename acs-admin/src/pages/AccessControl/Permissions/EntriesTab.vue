<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || p.loading || grants.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.entries" :default-sort="initialSort" :columns="columns" :filters="[]">
    <template #toolbar-left>
      <Alert class="mr-6">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info mt-1"></i>
          <div class="flex flex-col">
            <AlertTitle>Entries</AlertTitle>
            <AlertDescription>
              Manage the entries that link this permission to principals and groups.
            </AlertDescription>
          </div>
        </div>
      </Alert>
    </template>
  </DataTable>
</template>

<script>
import DataTable from '@components/ui/data-table/DataTable.vue'
import {Skeleton} from '@components/ui/skeleton/index.js'
import {columns} from './entriesColumns.ts'
import {Alert, AlertDescription, AlertTitle} from '@components/ui/alert/index.js'
import {useGroupStore} from '@store/useGroupStore.js'
import {usePrincipalStore} from "@store/usePrincipalStore.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {UUIDs} from "@amrc-factoryplus/service-client";
import {useGrantStore} from "@store/useGrantStore.js";
import {useObjectStore} from "@store/useObjectStore.js";

export default {
  name: 'Principals',

  emits: ['objectClick'],

  setup () {
    return {
      columns,
      p: usePrincipalStore(),
      g: useGroupStore(),
      s: useServiceClientStore(),
      grants: useGrantStore(),
      obj: useObjectStore(),
    }
  },

  provide () {
    return {
      permissionMembershipUpdated: this.updateData,
      objectClicked: (object) => {this.$emit('objectClick', object)},
    }
  },

  computed: {
    initialSort () {
      return [{
        id: 'principal',
        desc: false
      }]
    },
    entries() {
      this.loading = true

      const fullList = this.grants.data
      const filteredList = fullList.filter(e => e.permission === this.permission.uuid)

      const rv = []
      for (const entry of filteredList) {
        const newEntry = {
          uuid: entry.uuid
        }

        // Get data for the Target
        newEntry.target = entry.target === UUIDs.Special.Null ? {uuid: UUIDs.Special.Null, name: 'Wildcard'} :
            this.p.data.find(e => e.uuid === entry.target) ??
            this.g.data.find(e => e.uuid === entry.target) ??
            this.obj.data.find(e => e.uuid === entry.target) ??
            {
              uuid: entry.target,
              name: "UNKNOWN"
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

        newEntry.principal = this.p.data.find(e => e.uuid === entry.principal) ?? this.g.data.find(e => e.uuid === entry.principal)

        newEntry.permission = this.permission
        newEntry.plural = entry.plural;
        rv.push(newEntry)
      }

      this.loading = false
      return rv
    }
  },

  methods: {
    async updateData () {
      this.s.client.Fetch.cache = 'reload'
      await this.grants.fetch()
      this.s.client.Fetch.cache = 'default'
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
      loading: false
    }
  },

}
</script>

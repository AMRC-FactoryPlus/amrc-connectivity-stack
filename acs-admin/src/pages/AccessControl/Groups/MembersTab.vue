<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Skeleton v-if="g.loading || loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="this.members" :columns="columns" :filters="[]">
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

export default {
  name: 'GroupMembership',

  setup () {
    return {
      columns,
      p: usePrincipalStore(),
      g: useGroupStore(),
      s: useServiceClientStore()
    }
  },

  async created() {
    // Fill in the member details
    this.loading = true
    this.members = await Promise.all(this.group.members.map(async (memberUUID) => {
      let obj = this.p.data.find(v => v.uuid === memberUUID)
      if (obj && (obj.name || obj.kerberos)) {
        return {
          uuid: memberUUID,
          name: obj.name ?? obj.kerberos
        }
      }
      try {
        let objectResponse = await useServiceClientStore().client.ConfigDB.get_config(UUIDs.App.Info, memberUUID);
        let memberName = objectResponse.name
        return {
          uuid: memberUUID,
          name: memberName
        }
      } catch (err) {
        console.error(`Can't read member details`, err)
        return {
          uuid: memberUUID,
        }
      }
    }))
    this.loading = false
  },

  components: {
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
      members: []
    }
  },

}
</script>
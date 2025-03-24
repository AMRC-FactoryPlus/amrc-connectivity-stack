<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  Some Application
  <Skeleton v-if="false" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTable v-else :data="list" :columns="columns" :filters="[]" @row-click="e => objectClick(e.original)"/>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './applicationListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useRouter} from "vue-router";

export default {
  emits: ['rowClick'],

  setup () {
    return {
      columns: columns,
      router: useRouter(),
    }
  },

  components: {
    Card,
    Skeleton,
    DataTable,
  },

  computed: {
  },

  methods: {
    objectClick: (obj) => {
      console.log(obj)
      if (obj.uuid) {
        this.router.push({ path: `/configdb/applications/uuid/${obj.uuid}` })
      } else {
        this.router.push({ path: `/configdb/applications/uuid` })
      }
    }
  },

  data() {
    return {
      list: [
        {
          uuid: "uuid",
          name: "Test Object",
          objects: [
            {
              uuid: "uuid",
            },
            {
              uuid: "uuid",
            },
            {
              uuid: "uuid",
            }
          ]
        },
        {
          uuid: "uuid",
          name: "Test Object 2",
          objects: [
            {
              uuid: "uuid",
            },
            {
              uuid: "uuid",
            },
            {
              uuid: "uuid",
            }
          ]
        }
      ]
    }
  }
}
</script>
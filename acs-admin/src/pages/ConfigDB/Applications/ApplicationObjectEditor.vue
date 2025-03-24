<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  Some Application Object
  <Skeleton v-if="false" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <div>Editor</div>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './applicationListColumns.ts'
import {Card} from "@components/ui/card/index.js";

export default {
  emits: ['rowClick'],

  setup () {
    return {
      columns: columns,
    }
  },

  components: {
    Card,
    Skeleton,
    DataTable,
  },

  computed: {
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
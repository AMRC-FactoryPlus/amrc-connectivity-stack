<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="app.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTableSearchable v-else
                       :data="app.data"
                       :default-sort="initialSort"
                       :columns="columns"
                       :filters="[]"
                       :selected-objects="[]"
                       :clickable="true"
                       :search-key="'name'"
                       :limit-height="false"
                       @row-click="e => $emit('rowClick', e)"/>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import { columns } from './applicationListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useApplicationStore} from "@store/useApplicationStore.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";

export default {
  emits: ['rowClick'],

  setup () {
    return {
      columns: columns,
      app: useApplicationStore(),
    }
  },

  components: {
    DataTableSearchable,
    Card,
    Skeleton,
  },

  computed: {
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
    filterOptions () {
      return {
        names: this.app.data.map((p) => p.name).filter((v, i, a) => a.indexOf(v) === i).map((p) => {
          return {
            label: p,
            value: p,
          }
        }),
      }
    },
  },

  data() {
    return {
    }
  }
}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->


<template>
  <DataTableSearchable
                       :columns="columns"
                       :data="files"
                       :limit-height="false"
                       :filters="[]"
                       :selected-objects="[]"
                       @row-click="e => objectClick(e.original)"
  >
    <template #toolbar-right>
      <Button class="gap-2">
        <span>Upload File</span>
      </Button>
    </template>
  </DataTableSearchable>
</template>
<script>

import {Button} from "@components/ui/button/index.js";
import {Skeleton} from "@components/ui/skeleton/index.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import {columns} from "./TableData/filesListCollumns.ts";
import {useFileStore} from "@store/useFileStore";

export default {
  emits: ['rowClick'],
  name: 'Files',
  components: {DataTableSearchable, Skeleton, Button},

  setup () {
    return {
      file: useFileStore(),
      columns: columns,
    }
  },

  async mounted() {
    await this.file.start()
  },

  computed: {
    files () {
      return this.file.data;
    },
    filesLoading () {
      return !this.file.ready || this.file.loading
    },
  },
  methods: {
    async objectClick(e){
      console.log(e)
    },

  },

  unmounted() {
    this.file.stop()
  }
}

</script>
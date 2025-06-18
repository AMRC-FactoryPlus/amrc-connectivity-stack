<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->


<template>
  <FilesContainer>
    <Skeleton v-if="!file.ready" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
    <DataTableSearchable v-else
                         :columns="columns"
                         :data="files"
                         :limit-height="false"
                         :clickable="true"
                         :filters="[]"
                         :selected-objects="[]"
                         :default-sort="initialSort"
                         @row-click="e => objectClick(e.original)"
    >
      <template #toolbar-right>
        <Button class="gap-2" disabled>
          <span>Upload File</span>
        </Button>
      </template>
    </DataTableSearchable>
    <template v-slot:sidebar>
      <!-- Sidebar -->
      <div class="w-96 border-l border-border -mr-4">
          <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-2">
                <i class="fa-fw fa-solid fa-file"></i>
                <div class="font-semibold text-xl">File</div>
              </div>
              <Button title="Go to config entry" size="xs" class="flex gap-1" @click="goToObject" variant="ghost">
                <i class="fa-solid fa-external-link text-gray-400"></i>
              </Button>
            </div>
            <Button class="flex mr-2" variant="outline" :disabled="!selectedRow.file_uuid" @click="download">
              <span>Download</span>
            </Button>
          </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="key"
              label="File UUID"
              :value="this.selectedRow.file_uuid ?? null"
          />
          <SidebarDetail
              icon="address-card"
              label="File Name"
              :value="this.selectedRow.original_file_name ?? null"
          />
          <SidebarDetail
              icon="calendar"
              label="Created At"
              :value="this.selectedRow.date_uploaded ?? null"
          />
          <SidebarDetail
              icon="user"
              label="Created By"
              :value="this.selectedRow.user_who_uploaded ?? null"
          />
          <SidebarDetail
              icon="archive"
              label="Size"
              :value="this.selectedRow?.file_size?.toString() ? formatFileSize(this.selectedRow.file_size.toString()) : null"
          />
          <SidebarDetail
              icon="file"
              label="Type"
              :value="this.resolveType() ?? null"
          />
        </div>
      </div>
    </template>
  </FilesContainer>
</template>
<script>

import {Button} from "@components/ui/button/index.js";
import {Skeleton} from "@components/ui/skeleton/index.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import FilesContainer from '@components/Containers/FilesContainer.vue';
import {columns} from "./TableData/filesListCollumns.ts";
import {useFileStore} from "@store/useFileStore";
import SidebarDetail from "@components/SidebarDetail.vue";
import {ref} from "vue";
import {useRouter} from "vue-router";
import { UUIDs } from "@amrc-factoryplus/service-client"
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {formatFileSize} from '@/lib/utils'
import {useDirectStore} from "@store/useDirectStore.js";
import {useObjectStore} from "@store/useObjectStore.js";
import {useFileDownload} from "@composables/useFileDownload.js";

export default {
  emits: ['rowClick'],
  name: 'Files',
  components: {SidebarDetail, DataTableSearchable, Skeleton, Button, FilesContainer},

  setup () {
    return {
      selectedRow: ref({}),
      file: useFileStore(),
      columns: columns,
      router: useRouter(),
      s: useServiceClientStore(),
      directStore: useDirectStore(),
      objectStore: useObjectStore(),
    }
  },

  async mounted() {
    await this.file.start();
    await this.directStore.start();
    await this.directStore.start();
  },

  computed: {
    files () {
      return this.file.data;
    },
    initialSort () {
      return [{
        id: 'created',
        desc: true
      }]
    }
  },
  methods: {
    formatFileSize,
    async objectClick(config){
      this.selectedRow = config.filesConfiguration ?? {};
      },
    goToObject(){
      if(!this.selectedRow?.file_uuid)
        return
      this.router.push({ path: `/configdb/applications/${UUIDs.App.FilesConfig}/${this.selectedRow.file_uuid}`})
    },
    async download(){
      if(!this.selectedRow?.file_uuid)
        return;
      const name = this.selectedRow.original_file_name ?? this.selectedRow.file_uuid;
      await useFileDownload(this.s.client, name, this.selectedRow.file_uuid);
    },
    resolveType(){
      if(!this.selectedRow?.file_uuid)
        return;
      // Find the file type objects
      const fileTypeDirectMemberships = this.directStore.data
          .find(group => group.uuid === UUIDs.Class.FileType);

      // Find the file objects membership
      const fileDirectMemberships = this.directStore.data
          .filter(group => group.directMembers.includes(this.selectedRow.file_uuid)).map(m => m.uuid);
      const fileDirectMembershipObjs = fileDirectMemberships.map(membership => {
        return this.objectStore.data.find(o => o.uuid === membership)
      });
      // Check if the file is a member of a type.
      let type;
      for(let i = 0; i < fileDirectMembershipObjs.length; i++){
        if(fileTypeDirectMemberships?.directMembers.includes(fileDirectMembershipObjs[i]?.uuid)){
          type = fileDirectMembershipObjs[i]?.name;
          break;
        }
      }
      return type
    }
  },
  async unmounted() {
    await this.file.stop();
    this.directStore.stop();
    this.objectStore.stop();
  }
}

</script>
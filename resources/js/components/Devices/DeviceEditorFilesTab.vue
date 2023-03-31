<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex-grow overflow-y-auto flex flex-col items-center">
    <UploadNewFileOverlay :show="showNewFileOverlay" @close="showNewFileOverlay=false" :available-file-types="availableFileTypes" :device="device"></UploadNewFileOverlay>
    <div v-if="selectedFile" class="flex-grow flex flex-col overflow-y-auto p-3 pr-6 w-full">
      <div class="flex items-center justify-start mb-2">
        <button @mouseup="selectedFile = null" class="fpl-button-secondary w-32 h-10">
          <i class="fa-sharp fa-solid fa-arrow-left mr-2"></i>
          Back
        </button>
        <h2 class="font-bold text-brand ml-3 mb-0">
          {{ selectedFile.friendly_title }}
        </h2>
        <button type="button"
                @mouseup="() => {downloadFile(selectedFile.file_uuid)}"
                class="fpl-button-brand w-32 h-10 ml-auto">
          <div class="mr-2">Download</div>
          <i class="fa-sharp fa-solid fa-download text-xs"></i>
        </button>
      </div>
      <FileDetails :selected-file-details="selectedFileDetails" :device="device"></FileDetails>
    </div>
    <ColumnList v-else name="Files" class="w-full" @selected="selectFile"
                :selected-item="selectedFile ? selectedFile.file_uuid : null"
                property="deviceFiles"
                :loading="deviceFilesLoading" :items="deviceFiles" :show-divider="false">
      <template #actions>
        <button type="button"
                @mouseup="attachNewFile"
                class="fpl-button-brand w-32 h-10 ml-auto">
          <div class="mr-2">Attach File</div>
          <i class="fa-sharp fa-solid fa-plus text-xs"></i>
        </button>
      </template>
      <template #empty>
        <div class="text-center pb-3 flex-grow flex flex-col items-center justify-center">
          <i class="fa-sharp fa-solid fa-plug fa-2x text-gray-500"></i>
          <h3 class="mt-2 text-sm font-medium text-gray-700">No Files</h3>
          <p class="mt-1 text-sm text-gray-400">You can attach files to this device that can be received by the Consumption Framework</p>
          <div class="mt-6">
            <button type="button"
                    @click.stop="attachNewFile"
                    class="fpl-button-brand h-10 px-3 mr-1">
              <div class="mr-2">New File</div>
              <i class="fa-sharp fa-solid fa-plus text-xs"></i>
            </button>
          </div>
        </div>
      </template>
      <template v-slot:item="{ item }">
        <div class="flex items-center flex-1 px-4 py-2 text-sm truncate h-16 gap-4">
          <div v-if="moment().subtract(10, 'minutes').isBefore(item.timestamp)"
               class="inline-flex items-center px-2.5 py-0.5  text-sm font-medium bg-green-100 text-green-800">New
          </div>
          <div class="flex flex-col overflow-hidden mr-4">
            <div class="text-gray-500 font-semibold truncate overflow-ellipsis">{{ item.friendly_title }}</div>
            <div class="text-xs text-gray-400 truncate overflow-ellipsis">{{ item.file_type.title }}</div>
          </div>
          <div class="flex flex-col ml-auto items-end gap-1">
            <div v-if="!item.file" class="inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-blue-500 text-white">{{ item.file_type.mime_type.mime }}</div>
            <div class="text-xs text-gray-400 truncate overflow-ellipsis">Updated {{ moment(item.timestamp).fromNow() }}</div>
          </div>
        </div>
      </template>
    </ColumnList>
  </div>
</template>

<script>
export default {
  name: 'DeviceEditorFilesTab',

  components: {
    ColumnList: () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
    FileDetails: () => import(/* webpackPrefetch: true */ './FileDetails.vue'),
    UploadNewFileOverlay: () => import(/* webpackPrefetch: true */ './Files/UploadNewFileOverlay.vue'),
  },

  props: {
    device: { required: true },
    deviceFiles: { required: true },
    selectedFileDetails: { required: true },
    availableFileTypes: { required: true },
  },

  watch: {
    selectedFile: {
      handler () {
        if (!this.selectedFile) {return;}
        this.requestDataReloadFor('selectedFileDetails', null, { file: this.selectedFile.file_uuid });
      }, deep: true,
    },
  },

  computed: {},

  mounted () {},

  methods: {
    selectFile (file) {
      this.selectedFile = file;
    },

    attachNewFile () {
      this.showNewFileOverlay = true;
    },

    downloadFile (fileUuid) {
      if (!this.selectedFile) {return;}
      axios.get('/api/devices/' + this.device.id + '/files/'+this.selectedFileDetails.file_uuid+'/download', {
        file_uuid: fileUuid,
      }).then(e => {
        this.goto_url_tab(JSON.parse(e.data.data).url);
      });
    },
  },

  data () {
    return {
      selectedFile: null,
      deviceFilesLoading: false,
      showNewFileOverlay: false,
    };
  },
};
</script>
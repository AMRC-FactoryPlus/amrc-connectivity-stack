<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay :show="show" @close="$emit('close')" title="Upload New File">
    <template #content>
      <input
          class="hidden"
          ref="fileUploader"
          type="file"
          name="file"
          :accept="selectedFileType?.mime_type?.mime"
          @change="processSelectedFile"
      />
      <div v-if="selectedFileType" class="flex-grow flex flex-col overflow-y-auto p-3 pr-6 w-full gap-6">
        <div class="flex items-center justify-start">
          <button @mouseup="selectedFileType = null" class="fpl-button-secondary w-32 h-10">
            <i class="fa-sharp fa-solid fa-arrow-left mr-2"></i>
            Back
          </button>
          <h2 class="font-bold text-brand ml-3 mb-0">
            Upload a new {{ selectedFileType.title }}
          </h2>
          <div class="inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-blue-500 text-white ml-auto">{{ selectedFileType.mime_type.mime }}</div>
        </div>
        <Input :showDescription="true" :control="{
          name: 'Name',
          description: 'Use this field to give this file a more specific name (e.g. KUKA Omnimove servicing manual)',
        }" :valid="v.newFile.friendly_title" v-model="v.newFile.friendly_title.$model"/>
        <Input :showDescription="true" :control="{
          name: 'Description',
          description: 'Use this field to add more detail to the file',
        }" :valid="{}" v-model="v.newFile.$model.friendly_description"/>
        <div class="flex flex-col">
          <div class="flex items-end justify-between">
            <h2>Tags</h2>
            <button @click="v.newFile.$model.tags.push({key: null, value: null})" type="button"
                    class="fpl-button-brand flex items-center justify-center h-10 w-10">
              <i class="fa-solid fa-plus fa-fw"></i>
            </button>
          </div>
          <div class="text-gray-400 text-xs text-left flex-1">Tags are customisable metadata that you can assign to files to give them more context</div>
        </div>
        <div v-for="tag in newFile.tags" class="flex gap-4">
          <Input :showDescription="false" :control="{
          name: 'Key',
        }" :valid="{}" v-model="tag.key"/>
          <Input :showDescription="false" :control="{
          name: 'Value',
        }" :valid="{}" v-model="tag.value"/>
          <button v-tooltip="'Remove Tag'" @mouseup="removeTag(tag)" class="fpl-button-secondary flex items-center justify-center h-10 w-10 mt-6">
            <i class="fa-sharp fa-solid fa-times"></i>
          </button>
        </div>
        <button @click="showFileChooser" type="button"
                class="border border-dashed border-gray-300 bg-gray-100 flex items-center justify-center h-24 inline-flex items-center text-left text-gray-500 hover:bg-gray-200 active:bg-gray-300 group">
          <i class="fa-solid fa-file mr-2"></i>
          <span v-if="!newFile.file" class="text-sm group-hover:text-gray-600 italic">Browse for File</span>
          <span v-else class="text-sm group-hover:text-gray-600 italic">{{ newFile.file.name }}</span>
        </button>
        <button @mouseup="performUpload" :disabled="uploading || (v && (!v.$dirty || v.$invalid))" class="fpl-button-brand h-10 ml-auto w-32 mt-6">
          <div v-if="uploading === false" class="text-base mr-3 ml-10 flex items-center justify-center">
            Upload
            <i class="fa-sharp fa-solid fa-upload ml-2"></i>
          </div>
          <i v-if="uploading === false" class="mr-10"></i>
          <div v-else class="w-12">
            <i class="fa-sharp fa-solid fa-circle-notch fa-spin"></i>
          </div>
        </button>
      </div>
      <ColumnList v-else name="Files" class="w-full" @selected="selectFileType"
                  :selected-item="null"
                  property="deviceFiles"
                  :loading="false" :items="availableFileTypes" :show-divider="false">
        <template v-slot:item="{ item }">
          <div class="flex items-center flex-1 px-4 py-2 text-sm truncate h-16 gap-4">
            <div class="flex flex-col overflow-hidden mr-4">
              <div class="text-gray-500 font-semibold truncate overflow-ellipsis">{{ item.title }}</div>
            </div>
            <div class="flex flex-col ml-auto items-end gap-1">
              <div v-if="!item.file" class="inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-blue-500 text-white">{{ item.mime_type.mime }}</div>
            </div>
          </div>
        </template>
      </ColumnList>
    </template>
  </overlay>
</template>

<script>
import { required, minLength, helpers } from '@vuelidate/validators';
import useVuelidate from '@vuelidate/core';

export default {
  setup () {
    return { v: useVuelidate() };
  },

  name: 'UploadNewFileOverlay',
  components: {
    'overlay': () => import(/* webpackPrefetch: true */ '../../General/Overlay.vue'),
    'ColumnList': () => import(/* webpackPrefetch: true */ '../../General/ColumnList.vue'),
  },
  props: {
    show: { required: true, type: Boolean },
    availableFileTypes: { required: true },
    device: { required: true },
  },

  watch: {
    show: {
      handler () {
        this.requestDataReloadFor('availableFileTypes');
      }, deep: true,
    },
  },

  methods: {
    showFileChooser () {
      this.$refs.fileUploader.click();
    },

    removeTag(tag) {
      const index = this.newFile.tags.indexOf(tag);
      if (index > -1) { // only splice array when item is found
        this.newFile.tags.splice(index, 1); // 2nd parameter means remove one item only
      }
    },

    processSelectedFile (e) {
      this.v.newFile.file.$model = e.target.files[0];
    },

    selectFileType (type) {
      this.selectedFileType = type;
    },

    performUpload () {
      if (!this.selectedFileType) {return;}
      this.uploading = true;
      const config = { headers: { 'Content-Type': 'multipart/form-data' } };
      const data = new FormData();
      data.append('_method', 'POST');
      if (this.newFile.file) {
        let tags = {};
        this.newFile.tags.forEach(e => {
          tags[e.key] = e.value;
        });

        data.append('friendly_title', this.newFile.friendly_title);
        data.append('friendly_description', this.newFile.friendly_description);
        data.append('file', this.newFile.file);
        data.append('instance_uuid', this.device.instance_uuid);
        data.append('file_type_key', this.selectedFileType.key);
        data.append('uploader', this.$root.$data.user.username);
        data.append('tags', JSON.stringify(tags));
        axios.post('/api/devices/'+this.device.id+'/files', data, config).then(() => {
          this.uploading = false;
          this.newFile = {
            file: null,
            friendly_title: null,
            friendly_description: null,
            tags: [],
          };
          this.selectedFileType = null;
          this.$emit('close');
          this.requestDataReloadFor('deviceFiles');
        }).catch(error => {
          this.uploading = false;
          if (error && error.response && error.response.status === 401) {
            this.goto_url('/login');
          }
          this.handleError(error);
        });
      }
    },
  },

  validations () {
    return {
      newFile: {
        file: {
          required,
        },
        friendly_title: {
          required,
          minLength: minLength(3),
          deviceNameValid: helpers.withMessage('A title must be provided and can only use alphanumeric characters', helpers.regex(/^[-_ a-zA-Z0-9]+$/i)),
        },
      },
    };
  },

  data () {
    return {
      availableFileTypesPreventLoad: true,
      availableFileTypesLoading: false,
      uploading: false,
      newFile: {
        file: null,
        friendly_title: null,
        friendly_description: null,
        tags: [],
      },
      selectedFileType: null,
    };
  },
};
</script>
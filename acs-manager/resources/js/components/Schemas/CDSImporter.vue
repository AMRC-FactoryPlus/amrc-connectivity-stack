<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="overflow-auto">
    <div class="text-sm text-gray-500 mb-3">The CDS importer allows you to migrate from old Factory+ CDS files to the new Factory+ Schema format with minimal
      configuration.
    </div>
    <div class="relative" v-if="metricsToImport">
      <div class="grid grid-cols-9 p-2 relative" v-for="metric in metricsToImport">
        <div v-tooltip="metric.friendlyName" class="col-span-3 text-gray-700 truncate overflow-ellipsis cursor-default">{{ metric.friendlyName }}</div>
        <div class="flex items-center justify-center">
          <i class="fa-solid fa-arrow-right text-gray-300"></i>
        </div>
        <OverflowMenu v-if="options" class="col-span-5 w-full"
                      @selected="mapCDSItem($event, metric)"
                      :valid="{}"
                      :options="options">
          <button type="button"
                  class="inline-flex justify-center w-full border pl-4 py-2 bg-white font-medium text-gray-700 fpl-input"
                  :class="[metric.Name in mapping ? '!border-green-400 !bg-green-100' : '!border-red-400 !bg-red-100']"
                  id="menu-button" aria-expanded="true" aria-haspopup="true">
            <div v-tooltip="metric.Name in mapping ? mapping[metric.Name].schemaMapping.namePath.join('/') : null" class="flex-grow truncate">
              {{ metric.Name in mapping ? mapping[metric.Name].schemaMapping.namePath.join('/') : 'Choose' }}
            </div>
            <i class="fa-solid fa-chevron-down text-gray-400"></i>
          </button>
        </OverflowMenu>
      </div>
      <div class="flex justify-between bottom-0 right-0 left-0 bg-white p-3 mt-10 bg-gray-50">
        <button @click="showFileChooser" class="h-12 !px-4 text-red-300">
          Start Over
          <i class="fa-sharp fa-solid fa-undo ml-2"></i>
        </button>
        <button @click="save" class="fpl-button-brand h-12 !px-4">
          Save
          <i class="fa-sharp fa-solid fa-save ml-2"></i>
        </button>
      </div>
    </div>
    <div v-else-if="cds">
      <div class="mb-3">Please choose a device from this CDS to import.</div>
      <form-control-selection :col="true" :control="{options: devicesToImport}"
                              @valueUpdated="selectCDSToImport"/>
    </div>
    <div v-else-if="file === null">
      <div class="bg-red-50 border border-red-100 p-3 text-red-500 font-black flex items-center gap-x-2 mt-3 mb-5">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <div>Your existing configuration will be modified and/or replaced when using this importer.</div>
      </div>
      <button @click="showFileChooser" type="button"
              class="border border-dashed border-gray-400 px-3 py-2 inline-flex items-center text-left text-gray-500 hover:bg-gray-100 group">
        <i class="fa-solid fa-paperclip mr-2"></i>
        <span class="text-sm group-hover:text-gray-600 italic">Browse for CDS</span>
      </button>
    </div>
    <input
        class="hidden"
        ref="fileUploader"
        type="file"
        name="image"
        accept=""
        @change="uploadFile"
    />
    <!--<ColumnList name="Device Schema" description="Choose a schema to represent the device you are configuring." @selected="selectDeviceSchema" :selected-item="selectDeviceSchema ? selectDeviceSchema.id : null" property="deviceSchemas"-->
    <!--             :loading="deviceSchemasLoading" :items="deviceSchemas" :show-divider="false">-->
    <!--  <template v-slot:item="{ item }">-->
    <!--    <div class="flex-1 px-4 py-2 text-sm truncate h-10 flex flex-col justify-center">-->
    <!--      <a href="#" class="text-gray-600 font-semibold">{{ item.name }}</a>-->
    <!--    </div>-->
    <!--  </template>-->
    <!--</ColumnList>-->
    <!--<ColumnList name="Version" description="Choose the version of the schema to use." v-if="selectedDeviceSchema" @selected="selectDeviceSchemaVersion"-->
    <!--             :selected-item="selectDeviceSchemaVersion ? selectDeviceSchemaVersion.id : null" property="deviceSchemaVersions"-->
    <!--             :loading="deviceSchemaVersionsLoading" :items="deviceSchemaVersions" :show-divider="false">-->
    <!--  <template v-slot:item="{ item }">-->
    <!--    <div class="flex-1 px-4 py-2 text-sm truncate flex flex-col justify-center">-->
    <!--      <a href="#" class="text-gray-600 font-semibold">Version {{ item.version }}</a>-->
    <!--      <a href="#" class="text-gray-400">Created {{ moment(item.created_at).fromNow() }}, Updated {{ moment(item.updated_at).fromNow() }}</a>-->
    <!--    </div>-->
    <!--  </template>-->
    <!--</ColumnList>-->
  </div>
</template>
<script>
import { isObject } from 'lodash';

export default {
  name: 'CDSImporter',
  props: {
    /**
     * The schema that we're importing to
     */
    schema: {
      required: true,
      type: Object,
    },
    /**
     * A value that changes when the metrics need to be rebuilt
     */
    rerenderTrigger: {
      required: true,
    },
  },

  components: {
    'form-control-selection': () => import(/* webpackPrefetch: true */ '../FormControls/Selection.vue'),
    'OverflowMenu': () => import(/* webpackPrefetch: true */ '../OverflowMenu.vue'),
    'Dropdown': () => import(/* webpackPrefetch: true */ '../FormControls/Dropdown.vue'),
  },

  computed: {
    devicesToImport () {
      return this.cds.deviceConnections.map(e => e.devices).flat().map(e => {
        return {
          title: e.deviceId,
          description: e.deviceType,
          payload: e,
        };
      });
    },
  },

  mounted () {
    this.options = this.buildOptions(this.schema);
    // console.log('Building Options on initial load: ', this.options);
  },

  watch: {
    rerenderTrigger () {
      this.options = this.buildOptions(this.schema);
      // console.log('Building Options after watch: ', this.options);
    },
    schema: {
      handler (val) {
        this.options = this.buildOptions(val);
        // console.log('Building Options after watch: ', this.options);
      }, deep: true,
    },
  },

  methods: {
    mapCDSItem (data, metric) {
      // console.log(`Mapping ${metric.Name} to ${data.namePath.join('/')}`, metric);
      this.mapping[metric.Name] = {
        metric: metric,
        schemaMapping: data,
      };
      this.$forceUpdate();
    },

    save () {
        this.$emit('save', this.mapping);
    },

    buildOptions (schemaIn) {
      return Object.keys(schemaIn)
          .filter(key => !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(key))
          .map(key => {
            let payload = {
              title: key === '' ? 'None' : key,
              value: schemaIn[key],
              action: () => {
                return schemaIn[key];
              },
            };

            if (isObject(schemaIn[key]) && !('metric' in schemaIn[key])) {
              payload.options = this.buildOptions(schemaIn[key]);
            }

            return payload;
          });
    },

    showFileChooser () {
      this.$refs.fileUploader.click();
    },

    uploadFile (e) {
      this.file = e.target.files[0];
      const fr = new FileReader();
      fr.onload = e => {
        this.cds = JSON.parse(e.target.result);
        this.metricsToImport = null;
      };
      fr.readAsText(this.file);
    },

    flatten (data, c) {
      let result = {};
      for (let i in data) {
        if (typeof data[i] == 'object') Object.assign(result, this.flatten(data[i], c + '.' + i));
        else result[(c + '.' + i).replace(/^\./, '')] = data[i];
      }
      return result;
    },

    selectCDSToImport (e) {
      this.metricsToImport = e.payload.tags;
    },
  },

  data () {
    return {
      file: null,
      cds: null,
      metricsToImport: null,
      options: null,
      mapping: {},
    };
  },
};
</script>

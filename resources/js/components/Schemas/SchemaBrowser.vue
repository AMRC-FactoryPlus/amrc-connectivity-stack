<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div>
    <ColumnList
        v-if="!selectedDeviceSchema"
        name="Device Schema"
        description="Choose a schema to represent the device you are configuring."
        @selected="selectDeviceSchema"
        :selected-item="selectDeviceSchema ? selectDeviceSchema.id : null"
        property="deviceSchemas"
        :loading="deviceSchemasLoading"
        :items="deviceSchemas"
        :show-divider="false">
      <template
          v-slot:item="{ item }">
        <div class="flex-1 px-4 py-2 text-sm truncate h-10 flex flex-col justify-center">
          <a href="#" class="text-gray-600 font-semibold">{{ item.name }}</a>
        </div>
      </template>
    </ColumnList>
    <ColumnList
        name="Version"
        :description="'Choose the version of ' + selectedDeviceSchema.name + ' to use.'"
        description-action="(Change Schema)"
        @descriptionAction="clearSchema"
        v-else-if="!loading"
        @selected="selectDeviceSchemaVersion"
        :selected-item="selectDeviceSchemaVersion ? selectDeviceSchemaVersion.id : null"
        property="deviceSchemaVersions"
        :loading="deviceSchemaVersionsLoading"
        :items="deviceSchemaVersions"
        :show-divider="false">
      <template
          v-slot:item="{ item }">
        <div
            class="flex-1 px-4 py-2 text-sm truncate flex flex-col justify-center">
          <a href="#"
             class="text-gray-600 font-semibold">Version
            {{
              item.version
            }}</a>
          <a href="#"
             class="text-gray-400">Created
            {{
              moment(item.created_at).fromNow()
            }},
            Updated
            {{
              moment(item.updated_at).fromNow()
            }}</a>
        </div>
      </template>
    </ColumnList>
    <div
        v-if="loading"
        class="flex flex-grow w-full gap-x-6">
      <div
          class="flex items-center justify-center flex-grow">
        <div
            class="text-center mt-10 pb-3 flex-grow">
          <i class="fa-sharp fa-solid fa-circle-notch fa-spin fa-2x text-gray-300"></i>
          <h3 class="mt-2 text-sm font-medium text-gray-700">
            Initialising instance of {{ selectedDeviceSchema?.name }}</h3>
          <p class="mt-1 text-sm text-gray-400">Shouldn't take two seconds.</p>
        </div>
      </div>
    </div>
  </div>
</template>
<script>
export default {
  name: 'SchemaBrowser',
  props: {
    deviceSchemas: {},
    deviceSchemaVersions: {},
  },

  components: {
    'ColumnList': () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
  },

  methods: {

    clearSchema() {
      this.selectedDeviceSchema = null;
    },

    selectDeviceSchema(deviceSchema) {
      this.selectedDeviceSchema = deviceSchema;
      this.requestDataReloadFor('deviceSchemaVersions', null, {schema: this.selectedDeviceSchema.id});
    },

    selectDeviceSchemaVersion(deviceSchemaVersion) {
      this.selectedDeviceSchemaVersion = deviceSchemaVersion;
      this.loading = true;
      this.$emit('selected', {
        url: this.selectedDeviceSchema.url + '-v' + deviceSchemaVersion.version + '.json',
        device_schema_id: this.selectedDeviceSchema.id,
        schema_uuid: deviceSchemaVersion.schema_uuid
      });
    },
  },

  data() {
    return {
      selectedDeviceSchema: null,
      deviceSchemasLoading: false,

      loading: false,

      selectedDeviceSchemaVersion: null,
      deviceSchemaVersionsLoading: false,
      deviceSchemaVersionsPreventLoad: true,

    };
  },
};
</script>

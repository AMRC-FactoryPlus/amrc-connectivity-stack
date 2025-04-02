<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div>
    <ColumnList
        v-if="!selectedSchemaName"
        name="Device Schema"
        description="Choose a schema to represent the device you are configuring."
        @selected="selectDeviceSchema"
        :selected-item="null"
        property="schemaNames"
        :loading="deviceSchemasLoading"
        :items="schemaNames"
        :show-divider="false" :show-search="false">
      <template #admin-actions>
        <button v-if="showNew" @click="newSchema" class="fpl-button-brand h-10">
          <span>New</span>
          <i class="fa-sharp fa-solid ml-2 fa-plus"></i>
        </button>
      </template>
      <template v-slot:item="{ item }">
        <div class="flex-1 px-4 py-2 text-sm truncate h-10 flex flex-col justify-center">
          <a href="#" class="text-gray-600 font-semibold">{{ item }}</a>
        </div>
      </template>
    </ColumnList>
    <ColumnList
        name="Version"
        :description="'Choose the version of ' + selectedSchemaName + ' to use.'"
        description-action="(Change Schema)"
        @descriptionAction="clearSchema"
        v-else-if="!loading"
        @selected="selectDeviceSchemaVersion"
        :selected-item="null"
        property="schemaVersions"
        :loading="deviceSchemasLoading"
        :items="schemaVersions"
        :show-divider="false" :show-search="false">
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
              moment.unix(item.created).fromNow()
            }},
            Updated
            {{
              moment.unix(item.modified).fromNow()
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
            Initialising instance of {{ selectedSchemaName }}</h3>
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
    deviceSchemas: null,
    showNew: { required: false, type: Boolean, default: false}
  },

  components: {
    'ColumnList': () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
  },

  methods: {

    clearSchema() {
      this.selectedSchemaName = null;
    },

    selectDeviceSchema(name) {
      this.selectedSchemaName = name;
    },

    newSchema() {
      this.$emit('new-schema', {});
    },

    selectDeviceSchemaVersion(version) {
      this.loading = true;
      this.$emit('selected', {
        schema_uuid: version.uuid
      });
    },
  },

  data() {
    return {
      deviceSchemas: null,

      selectedSchemaName: null,
      deviceSchemasLoading: false,

      loading: false,

      selectedDeviceSchemaVersion: null,
      deviceSchemaVersionsLoading: false,
      deviceSchemaVersionsPreventLoad: true,
    };
  },

  computed: {
    schemaNames () {
      if (!this.deviceSchemas) return null;
      return Object.keys(this.deviceSchemas).toSorted();
    },

    schemaVersions () {
      if (!this.deviceSchemas) return null;
      if (!this.selectedSchemaName) return null;
      const vers = x => Number.parseInt(x.version, 10);
      return this.deviceSchemas[this.selectedSchemaName]
        .toSorted((a, b) => vers(a) - vers(b));
    },
  },
};
</script>

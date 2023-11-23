<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col flex-grow overflow-y-auto">
    <device-editor :device="device" :device-connections="deviceConnections" :device-schemas="deviceSchemas" :device-schema-versions="deviceSchemaVersions"></device-editor>
  </div>
</template>

<script>
export default {
  name: 'DeviceEditorContainer',

  components: {
    'device-editor': () => import(/* webpackPrefetch: true */ '../Devices/DeviceEditor.vue'),
  },

  props: {
    initialData: {},
  },

  watch: {},

  mounted () {
    this.initialiseContainerComponent();
  },

  methods: {},

  data () {
    return {
      isContainer: true,

      // device
      device: null,
      deviceLoading: null,
      deviceLoaded: null,
      deviceQueryBank: null,
      deviceRouteVar: null,

      // deviceConnections
      deviceConnections: null,
      deviceConnectionsLoading: null,
      deviceConnectionsLoaded: null,
      deviceConnectionsQueryBank: null,
      deviceConnectionsRouteVar: null,

      // deviceSchemas
      deviceSchemas: null,
      deviceSchemasLoading: null,
      deviceSchemasLoaded: null,
      deviceSchemasQueryBank: null,
      deviceSchemasRouteVar: null,
      deviceSchemasForceLoad: true,

      // deviceSchemaVersions
      deviceSchemaVersions: null,
      deviceSchemaVersionsLoading: null,
      deviceSchemaVersionsLoaded: null,
      deviceSchemaVersionsQueryBank: null,
    };
  },
};
</script>

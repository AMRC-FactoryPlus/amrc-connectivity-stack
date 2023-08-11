<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex bg-white m-3 overflow-auto flex-1 gap-1 h-100vh">
    <SchemaBrowserOverlay :show="schemaBrowserVisible" @close="schemaBrowserVisible=false"
                            :device-schemas="deviceSchemas"
                            :device-schema-versions="deviceSchemaVersions"
                            @schema-selected="selectSchema"></SchemaBrowserOverlay>
    <div v-if="schema" class="w-2/5 flex flex-col gap-3 p-2">
      <div class="flex items-center gap-2">
        <button disabled @click="" class="fpl-button-brand h-10">
          <span>New</span>
          <i class="fa-sharp fa-solid ml-2 fa-plus"></i>
        </button>
        <button @click="open" class="fpl-button-brand h-10">
          <span>Open</span>
          <i class="fa-sharp fa-solid ml-2 fa-folder"></i>
        </button>
      </div>
      <h2 v-if="schema" class="font-bold text-brand text-lg">{{ schema.$id.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','') }}</h2>
      <List :guides="false" :properties="schema.properties"></List>
      <div class="flex items-center">
        <button @click="copy" class="fpl-button-brand h-10 flex-1 gap-3">
          <span>Copy JSON</span>
          <i class="fa-sharp fa-solid ml-2 fa-copy"></i>
        </button>
        <button @click="download" class="fpl-button-secondary h-10 flex-1">
          <span>Download</span>
          <i class="fa-sharp fa-solid fa-download ml-2"></i>
        </button>
      </div>
    </div>
    <div class="flex-1 bg-gray-50">

    </div>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core'
import download from 'downloadjs'
import SchemaBrowserOverlay from '@/resources/js/components/Schemas/SchemaBrowserOverlay.vue'

export default {
  setup () {
    return { v$: useVuelidate({ $stopPropagation: true }) }
  },

  name: 'SchemaEditorContainer',

  computed: {
    isInvalid () {
      return this.v$.$dirty && this.v$.$invalid === true
    },
  },

  components: {
    SchemaBrowserOverlay,
    'List': () => import(/* webpackPrefetch: true */ '../SchemaEditor/List.vue'),
  },

  props: {
    initialData: {},
  },

  watch: {},

  mounted () {
    this.initialiseContainerComponent();

    // Load the schema in the query string if it exists
    let urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('schema')) {
      let schema = urlParams.get('schema');
      axios.post('/api/github-proxy/', {
        path: schema.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')
      }).then(k => {
        this.schema = k.data.data;
        if (!this.schema) {
          this.schemaBrowserVisible = true;
        }
      }).catch(error => {
        // Clear the query string if the schema is invalid
        urlParams.delete('schema');
      })
    } else {
      this.schemaBrowserVisible = true;
    }
  },

  methods: {
    download() {
      download(JSON.stringify(this.schema, null, 2), `${this.schema.$id.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')}`, "text/plain");
    },

    copy() {
      navigator.clipboard.writeText(JSON.stringify(this.schema, null, 2));
      window.showNotification({
        title: 'Copied',
        description: 'The JSON for this schema has been copied to the clipboard.',
        type: 'success',
      });
    },

    open() {
      this.schemaBrowserVisible = true;
    },

    selectSchema(schema) {
      this.schemaBrowserVisible=false;
      this.schema = schema.rawSchema;
    }
  },

  data () {
    return {
      isContainer: true,
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

      showRaw: false,
      schemaBrowserVisible: false,
      schema: null,
    }
  },

  validations () {
    return {}
  },
}
</script>

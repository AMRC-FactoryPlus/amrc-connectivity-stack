<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay :show="show" @close="$emit('close')" title="Select Device Schema">
    <template #content>
      <schema-browser v-if="show" :device-schemas="deviceSchemas" :device-schema-versions="deviceSchemaVersions"
                      @selected="schemaVersionSelected"/>
    </template>
  </overlay>
</template>

<script>
import $RefParser from '@apidevtools/json-schema-ref-parser'

export default {
  name: 'SchemaBrowserOverlay',
  components: {
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
    'schema-browser': () => import(/* webpackPrefetch: true */ '../Schemas/SchemaBrowser.vue'),
  },
  props: {
    show: { required: true, type: Boolean },
    deviceSchemas: { required: true },
    deviceSchemaVersions: { required: true },
  },

  methods: {
    async schemaVersionSelected (schemaObj) {
      // Get the raw JSON in case our caller needs that (e.g. Schema Editor)
      let raw = null;
      axios.post('/api/github-proxy/', {
        path: schemaObj.url.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')
      }).then(k => {
        let data = k.data
        raw = data.data

        // This resolves all references to other schemas and returns a JSON object of the complete flattened schema
        this.refParser.dereference(schemaObj.url, (err, parsedSchema) => {
          if (err) {
            console.error(err)
          } else {
            this.$emit('schema-selected', {
              parsedSchema: parsedSchema,
              schemaObj: schemaObj,
              rawSchema: raw,
            })
          }
        })
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login')
        }
        this.handleError(error)
      })
    },
  },

  data () {
    return {
      refParser: $RefParser,
      parsedSchema: null,
    }
  },
}
</script>

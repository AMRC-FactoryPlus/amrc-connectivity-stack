<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay :show="show" @close="$emit('close')" title="Select Device Schema">
    <template #content>
      <schema-browser :show-new="showNew" v-if="show" :device-schemas="deviceSchemas"
                      :device-schema-versions="deviceSchemaVersions"
                      @selected="schemaVersionSelected" @new-schema="newSchema"/>
    </template>
  </overlay>
</template>

<script>
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { v4 as uuidv4 } from 'uuid'

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
    showNew: { required: false, type: Boolean, default: false },
  },

  methods: {
    newSchema (p) {
      this.$emit('schema-selected', {
        parsedSchema: null,
        schemaObj: null,
        rawSchema: {
          '$id': `https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/${p.path}`,
          '$schema': 'https://json-schema.org/draft/2020-12/schema',
          'title': p.name,
          'description': p.description,
          'type': 'object',
          'properties': {
            'Schema_UUID': { 'const': uuidv4() },
            'Instance_UUID': {
              'description': 'The unique identifier for this object. (A UUID specified by RFC4122).',
              'type': 'string',
              'format': 'uuid',
            },
          },
          'required': ['Schema_UUID', 'Instance_UUID'],
        },
      })
    },

    async schemaVersionSelected (schemaObj) {
      // Get the raw JSON in case our caller needs that (e.g. Schema Editor)
      let raw = null
      axios.post('/api/github-proxy/', {
        path: schemaObj.url.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', ''),
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

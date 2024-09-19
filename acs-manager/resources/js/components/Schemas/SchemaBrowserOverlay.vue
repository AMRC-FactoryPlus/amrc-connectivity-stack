<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay :show="show" @close="$emit('close')" title="Select Device Schema">
    <template #content>
      <schema-browser :show-new="showNew" v-if="show" :device-schemas="deviceSchemas"
                      @selected="schemaVersionSelected" @new-schema="newSchema"/>
    </template>
  </overlay>
</template>

<script>
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

    /* XXX bmz: We should not be doing the fetches here. We have two
     * callers, the origin map editor which wants a deref'd schema and
     * the schema editor which wants a raw schema. We never need both,
     * so we should just return the info and leave the fetch to the
     * caller. */
    async schemaVersionSelected (schemaObj) {
      // Get the raw JSON in case our caller needs that (e.g. Schema Editor)
      const uuid = schemaObj.schema_uuid;
      const raw = await this.refParser.fetchSchema(uuid)
        .catch(error => this.handleError(error));
      const parsed = await this.refParser.dereference(uuid)
        .catch(err => this.handleError(err));

      this.$emit('schema-selected', {
        parsedSchema: parsed,
        schemaObj: schemaObj,
        rawSchema: raw,
      });
    },
  },

  data () {
    return {
      parsedSchema: null,
    }
  },

  inject: ["refParser"],
}
</script>

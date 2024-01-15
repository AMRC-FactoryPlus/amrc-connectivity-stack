<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<!-- TODO:-->
<!-- 1. Prevent sub-schemas opening by default. Instead show editor panel that allows name change and link to open -->
<!-- 2. Add sub-schema array support -->
<!-- 3. Add deletion of metrics, folders and sub-schemas -->

<template>
  <div class="flex bg-white m-3 overflow-auto flex-1 gap-1 h-100vh">
    <SchemaBrowserOverlay show-new :show="schemaBrowserVisible" @close="schemaBrowserVisible=false"
                          :device-schemas="deviceSchemas"
                          :device-schema-versions="deviceSchemaVersions"
                          @schema-selected="selectSchema"></SchemaBrowserOverlay>
    <SchemaBrowserOverlay :show="subSchemaBrowserVisible" @close="subSchemaBrowserVisible=false"
                          :device-schemas="deviceSchemas"
                          :device-schema-versions="deviceSchemaVersions"
                          @schema-selected="subSchemaSelected"></SchemaBrowserOverlay>
    <div v-if="schema" class="w-2/5 flex flex-col gap-3 p-2">
      <div class="flex items-center gap-2">
        <button @click="maybeNew" class="fpl-button-brand h-10">
          <span>New</span>
          <i class="fa-sharp fa-solid ml-2 fa-plus"></i>
        </button>
        <button @click="open" class="fpl-button-brand h-10">
          <span>Open</span>
          <i class="fa-sharp fa-solid ml-2 fa-folder"></i>
        </button>
      </div>
      <input class="font-bold text-brand text-lg bg-gray-100 p-2" v-model="name">
      <List @new="create" @rowSelected="handleRowSelection" @rowDeleted="handleRowDeletion" :guides="false" :properties="schema.properties"
            :uuid="null"></List>
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
      <MetricEditPanel v-if="selected && selected.type === 'metric'"
                       :selectedMetric="selected.payload"
                       @updateMetric="updateSelectedMetric"
                       @updateMetricName="renameSelected"
      ></MetricEditPanel>
      <FolderEditPanel v-if="selected && selected.type === 'folder'"
                       :selectedFolder="selected.payload"
                       @updateFolderName="renameSelected"
      ></FolderEditPanel>
    </div>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core'
import download from 'downloadjs'
import SchemaBrowserOverlay from '@/resources/js/components/Schemas/SchemaBrowserOverlay.vue'
import { v4 as uuidv4 } from 'uuid'
import { toRaw } from 'vue'

export default {
  setup () {
    return { v$: useVuelidate({ $stopPropagation: true }), toRaw }
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
    'MetricEditPanel': () => import(/* webpackPrefetch: true */ '../SchemaEditor/MetricEditPanel.vue'),
    'FolderEditPanel': () => import(/* webpackPrefetch: true */ '../SchemaEditor/FolderEditPanel.vue'),
  },

  props: {
    initialData: {},
  },

  watch: {
    name () {
      this.schema.$id = `https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/${this.name}.json`
    },
  },

  mounted () {
    this.initialiseContainerComponent()

    // Load the schema in the query string if it exists
    let urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('schema')) {
      let schema = urlParams.get('schema')
      axios.post('/api/github-proxy/', {
        path: schema.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', ''),
      }).then(k => {
        if (!k.data.data) {
          this.schemaBrowserVisible = true
        } else {
          this.selectSchema({ rawSchema: k.data.data })
        }
      }).catch(error => {
        // Clear the query string if the schema is invalid
        urlParams.delete('schema')
      })
    } else {
      this.schemaBrowserVisible = true
    }
  },

  methods: {
    create (e) {
      let uuid = uuidv4()

      const parent = this.getParentFromUUID(e.parent, this.schema)
      const targetPointer = parent?.properties ?? this.schema.properties

      switch (e.type) {
        case 'metric':
          this.$set(targetPointer, uuid, {
            uuid: uuid,
            index: e.index,
            allOf: [
              {
                $ref: 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Common/Metric-v1.json',
              },
              {
                properties: {
                  Documentation: {
                    default: '',
                  },
                  Sparkplug_Type: {
                    enum: [
                      'String',
                    ],
                  },
                },
              },
            ],
          })
          break
        case 'folder':
          this.$set(targetPointer, uuid, {
            uuid: uuid,
            index: e.index,
            'type': 'object',
            'properties': {},
            'required': [],
          })
          break
        case 'sub-schema':
          this.subSchemaBrowserVisible = true
          this.subSchemaBrowserType = 'sub-schema'
          this.subSchemaParent = e.parent
          this.subSchemaIndex = e.index
        case 'sub-schema-array':
          this.subSchemaBrowserVisible = true
          this.subSchemaBrowserType = 'sub-schema-array'
          this.subSchemaParent = e.parent
          this.subSchemaIndex = e.index
      }
    },

    handleRowSelection (e) {
      this.selected = e
    },

    handleRowDeletion (e) {
      let { grandparent, keyInGrandparent } = this.getParentOfObjectContainingUUID(e.uuid, this.schema)
      this.$delete(grandparent, keyInGrandparent)
    },

    getParentOfObjectContainingUUID (uuid, schema) {
      // Iterate through each key-value pair in the object
      for (const [key, testParent] of Object.entries(schema)) {
        // Check if value is an object and not null
        if (typeof testParent === 'object' && testParent !== null) {
          // Check if this object contains the uuid
          if (testParent.uuid === uuid) {
            // Return parent, grandparent, and key in grandparent
            return { parent: testParent, grandparent: schema, keyInGrandparent: key }
          }

          // Recursively search in this object
          const result = this.getParentOfObjectContainingUUID(uuid, testParent)
          if (result) return result
        }
      }

      // If no matching uuid is found, return null
      return null
    },

    renameSelected (name) {
      let { grandparent, keyInGrandparent } = this.getParentOfObjectContainingUUID(this.selected.payload.uuid,
          this.schema)

      if (keyInGrandparent !== name) {
        // Add the new property with reactivity
        this.$set(grandparent, name, grandparent[keyInGrandparent])
        // Delete the old property
        delete grandparent[keyInGrandparent]
      }
    },

    updateSelectedMetric (updatedMetric) {
      this.updateMetricWithUUID(updatedMetric, this.selected.payload.uuid)

    },

    updateMetricWithUUID (p, uuid) {
      let { grandparent, keyInGrandparent } = this.getParentOfObjectContainingUUID(uuid, this.schema)
      this.$set(grandparent[keyInGrandparent], 'allOf', p.property.allOf)
    },

    download () {
      download(JSON.stringify(this.getSchemaWithoutUUIDFields(this.schema), null, 2),
          `${this.schema.$id.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', '')}`,
          'text/plain')
    },

    copy () {
      navigator.clipboard.writeText(JSON.stringify(this.getSchemaWithoutUUIDFields(this.schema), null, 2))
      window.showNotification({
        title: 'Copied',
        description: 'The JSON for this schema has been copied to the clipboard.',
        type: 'success',
      })
    },

    open () {
      this.schemaBrowserVisible = true
    },

    selectSchema (schema) {
      this.schemaBrowserVisible = false
      this.schema = schema.rawSchema

      // Remove the URL up to main/ and .json from the end of the schema $id
      if (this.schema.$id.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', '') ===
          'undefined') {
        this.name = 'New_Schema-v1'
      } else {
        this.name = this.schema.$id.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', '').
            replace('.json', '')
      }

      // Stamp each metric with a UUID, that is, each object with an allOf key and two items in the array, throughout the entire nested schema.properties
      this.stampMetricsWithUUID(this.schema)
    },

    subSchemaSelected (schema) {
      this.subSchemaBrowserVisible = false

      if (this.subSchemaBrowserType === 'sub-schema') {
        const parent = this.getParentFromUUID(this.subSchemaParent, this.schema)
        const targetPointer = parent?.properties ?? this.schema.properties
        let uuid = uuidv4()

        this.$set(targetPointer, uuid, {
          uuid: uuid,
          index: this.subSchemaIndex,
          $ref: schema.rawSchema.$id,
        })
      }

      if (this.subSchemaBrowserType === 'sub-schema-array') {
        const parent = this.getParentFromUUID(this.subSchemaParent, this.schema)
        const targetPointer = parent?.properties ?? this.schema.properties
        let uuid = uuidv4()

        this.$set(targetPointer, uuid, {
          uuid: uuid,
          index: this.subSchemaIndex,
          patternProperties: {
            '^[a-zA-Z0-9_]*$': {
              $ref: schema.rawSchema.$id,
            },
          },
          type: 'object',
        })
      }

      this.subSchemaIndex = null
      this.subSchemaParent = null
      this.subSchemaBrowserType = null
    },

    /**
     * Find the parent folder with the specified UUID
     * @param uuid
     * @param schema
     * @returns {null}
     */
    getParentFromUUID (uuid, schema) {
      let parent = null

      if ('properties' in schema) {
        if ('uuid' in schema && schema.uuid === uuid) {
          parent = schema
        } else {
          for (const key in schema.properties) {
            if ('properties' in schema.properties[key]) {
              parent = this.getParentFromUUID(uuid, schema.properties[key])
              if (parent !== null) {
                return parent
              }
            }
          }
        }
      }

      return parent
    },

    stampMetricsWithUUID (schema) {
      if (schema.hasOwnProperty('properties')) {
        let index = 0
        for (const key in schema.properties) {
          // Check if we have a `properties` key for nested metrics
          if (schema.properties[key].hasOwnProperty('properties')) {
            this.stampMetricsWithUUID(schema.properties[key])
          } else {
            // Check for 'type' key rather than 'allOf' key with two items
            if (schema.properties[key].hasOwnProperty('allOf') && schema.properties[key].allOf.length === 2) {
              schema.properties[key].uuid = uuidv4()
              schema.properties[key].index = index
              index++
            }
          }
        }
      }

      return schema
    },

    getSchemaWithoutUUIDFields (inputSchema) {
      let s = toRaw(_.cloneDeep(inputSchema))

      if ('uuid' in s) {
        delete s.uuid
      }
      if ('properties' in s) {
        for (const key in s.properties) {
          if ('uuid' in s.properties[key]) {
            delete s.properties[key].uuid
          }
          if ('index' in s.properties[key]) {
            delete s.properties[key].index
          }
          if ('properties' in s.properties[key]) {
            s.properties[key] = this.getSchemaWithoutUUIDFields(s.properties[key])
          } else {
            if ('uuid' in s.properties[key]) {
              delete s.properties[key].uuid
            }
            if ('index' in s.properties[key]) {
              delete s.properties[key].index
            }
          }
        }
      }

      return s
    },

    maybeNew () {
      window.showNotification({
        title: 'Are you sure?',
        description: 'This will clear the current editor and any changes that you have not copied or downloaded will be lost.',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'New Schema', type: 'error', loadingOnClick: true, action: () => {
              window.hideNotification({ id: 'e9e52913-a393-4031-b37c-4704813729e4' })
              this.selectSchema({
                parsedSchema: null,
                schemaObj: null,
                rawSchema: {
                  '$id': `https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/${undefined}`,
                  '$schema': 'https://json-schema.org/draft/2020-12/schema',
                  'title': undefined,
                  'description': undefined,
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
          },
          { text: 'Cancel', isClose: true },
        ],
        id: 'e9e52913-a393-4031-b37c-4704813729e4',
      })
    },
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

      schemaBrowserVisible: false,

      subSchemaBrowserVisible: false,
      subSchemaBrowserType: null,
      subSchemaParent: null,
      subSchemaIndex: null,

      schema: null,
      name: 'New_Schema-v1',
      selected: null,

    }
  },

  validations () {
    return {}
  },
}
</script>

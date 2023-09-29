<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col flex-grow h-page overflow-y-auto">
    <overlay :show="newObjectContext" @close="newObjectContext = null" title="New Object">
      <template #content>
        <NewObjectOverlayForm @create="createObject"
                              :regex="Object.keys(newObjectContext[newObjectContext.length-1].value?.patternProperties)[0]"></NewObjectOverlayForm>
      </template>
    </overlay>
    <div v-if="loadingExistingConfig" class="flex flex-grow w-full gap-x-6">
      <div class="flex items-center justify-center flex-grow">
        <div class="text-center mt-10 pb-3 flex-grow">
          <i class="fa-sharp fa-solid fa-circle-notch fa-spin fa-2x text-gray-300"></i>
          <h3 class="mt-2 text-sm font-medium text-gray-700">Just a second...</h3>
          <p class="mt-1 text-sm text-gray-400">We're loading the existing configuration for this device</p>
        </div>
      </div>
    </div>
    <div v-else-if="loading" class="flex flex-grow w-full gap-x-6">
      <div class="flex items-center justify-center flex-grow">
        <div class="text-center mt-10 pb-3 flex-grow">
          <i class="fa-sharp fa-solid fa-circle-notch fa-spin fa-2x text-gray-300"></i>
          <h3 class="mt-2 text-sm font-medium text-gray-700">Validating schema...</h3>
          <p class="mt-1 text-sm text-gray-400">It may take a while, but it ensures that your configuration is safe to
            deploy to the edge.</p>
        </div>
      </div>
    </div>
    <div v-else-if="schema === null" class="flex flex-grow w-full gap-x-6">
      <div class="flex items-center justify-center flex-grow">
        <div class="text-center mt-10 pb-3 flex-grow">
          <i class="fa-sharp fa-solid fa-cogs fa-2x text-gray-500"></i>
          <h3 class="mt-2 text-sm font-medium text-gray-700">What is <span
              class="font-bold">{{device.device_id || 'this device'}}</span>?
          </h3>
          <p class="mt-1 text-sm text-gray-400">Get started by assigning this device a schema.</p>
          <div class="mt-6">
            <button type="button" @click.stop="schemaBrowserVisible=true"
                    class="fpl-button-brand h-10 px-3 mr-1">
              <div class="mr-2">Choose a Device Schema</div>
              <i class="fa-sharp fa-solid fa-plus text-xs"></i>
            </button>
          </div>
        </div>
      </div>
      <schema-browser-overlay :show="schemaBrowserVisible" @close="schemaBrowserVisible=false"
                              :device-schemas="deviceSchemas"
                              :device-schema-versions="deviceSchemaVersions"
                              @schema-selected="selectSchema"></schema-browser-overlay>
    </div>
    <div class="flex flex-col flex-grow overflow-auto" v-else>
      <!--            <keep-alive>-->
      <!--              <cds-import-overlay :schema="metrics" :show="showCDSImport" @close="showCDSImport=false"-->
      <!--                                  :rerender-trigger="rerenderTrigger"-->
      <!--                                  @save="applyMapping"></cds-import-overlay>-->
      <!--            </keep-alive>-->
      <div class="flex justify-between items-center w-full">
        <h2 v-if="schema" class="font-bold text-brand p-3">{{schema.title}}</h2>
      </div>
      <div class="flex flex-grow overflow-auto">
        <div class="flex flex-col overflow-y-auto flex-shrink-0 w-1/4">
          <SchemaGroup :key="groupRerenderTrigger" @selected="selectMetric" @newObject="newObject"
                       @deleteObject="maybeDeleteObject"
                       class="overflow-x-auto border-l-0" :schema="schema"
                       :selected-metric="selectedMetric" :model="model"></SchemaGroup>
          <div v-if="!loading"
               class="flex items-center justify-center p-3 grid grid-cols-1 mt-auto transition-all">
            <button v-if="isDirty" @click="save(true)" class="fpl-button-error h-10 ml-2"
                    :class="loading ? '!bg-opacity-50' : ''">
              <span>Save Changes</span>
              <i class="fa-sharp fa-solid fa-save ml-2"></i>
            </button>
          </div>
          <div v-else class="flex items-center justify-center p-3 mt-auto transition-all">
            <button disabled class="fpl-button-brand h-10 ml-2 w-full cursor-not-allowed opacity-50">
              <span>Validating</span>
              <i class="fa-sharp fa-solid fa-circle-notch fa-spin ml-2"></i>
            </button>
          </div>
        </div>
        <div v-if="metricLoading" class="flex flex-grow w-full gap-x-6">
          <div class="flex items-center justify-center flex-grow">
            <div class="text-center mt-10 pb-3 flex-grow">
              <i class="fa-sharp fa-solid fa-circle-notch fa-spin fa-2x text-gray-300"></i>
              <h3 class="mt-2 text-sm font-medium text-gray-700">Loading metric...</h3>
            </div>
          </div>
        </div>
        <div v-if="selectedMetric" class="flex flex-col h-full overflow-y-auto border-l">
          <SparkplugMetric :key="rerenderTrigger" :selected-metric="selectedMetric" :model="model"
                           @input="metricDetailsEdited" @loaded="metricLoading = false"></SparkplugMetric>
        </div>
        <div v-else class="flex flex-grow w-full gap-x-6">
          <div class="flex items-center justify-center flex-grow">
            <div class="text-center mt-10 pb-3 flex-grow">
              <i class="fas fa-tag fa-2x text-gray-500"></i>
              <h3 class="mt-2 text-sm font-medium text-gray-700">No Metric Selected</h3>
              <p class="mt-1 text-sm text-gray-400">Click on a metric on the left to configure it.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script>
import { v4 as uuidv4 } from 'uuid'
import $RefParser from '@apidevtools/json-schema-ref-parser'

export default {
  name: 'DeviceEditorOriginMapTab',

  props: {
    device: { required: true },
    deviceSchemas: { required: true },
    deviceSchemaVersions: { required: true },
  },

  components: {
    'schema-browser-overlay': () => import(/* webpackPrefetch: true */ '../Schemas/SchemaBrowserOverlay.vue'),
    'cds-import-overlay': () => import(/* webpackPrefetch: true */ '../Schemas/CDSImportOverlay.vue'),
    'SchemaGroup': () => import(/* webpackPrefetch: true */ './Schemas/SchemaGroup.vue'),
    'SparkplugMetric': () => import(/* webpackPrefetch: true */ './Schemas/SparkplugMetric.vue'),
    'NewObjectOverlayForm': () => import(/* webpackPrefetch: true */ './Schemas/NewObjectOverlayForm.vue'),
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
  },

  mounted () {
    // Prevent the window from reloading if we have a dirty state
    window.onbeforeunload = this.checkDirty

    document.addEventListener('keydown', this.doSave)
    this.loadExistingConfig()
  },

  watch: {
    schema: {
      handler: function (val, oldVal) {
        if (oldVal === null) {
          this.updateDynamicSchemaObjects()
        }
      },
      deep: true,
    },
  },

  beforeDestroy () {
    document.removeEventListener('keydown', this.doSave)
  },

  methods: {

    checkDirty () {
      if (this.isDirty) {
        return ''
      }
    },

    loadExistingConfig () {

      this.loadingExistingConfig = true
      if (!this.device.latest_origin_map) {
        this.loadingExistingConfig = false
        return
      }

      // 1. Get the latest version of the schema from the model
      let schemaObj = {
        url: this.device.latest_origin_map.schema_version.schema.url + '-v' +
            this.device.latest_origin_map.schema_version.version + '.json',
        device_schema_id: this.device.latest_origin_map.schema_version.device_schema_id,
        device_schema_version_id: this.device.latest_origin_map.device_schema_version_id,
      }
      this.refParser.dereference(schemaObj.url, (err, parsedSchema) => {
        if (err) {
          console.error(err)
        } else {
          this.selectSchema({
            parsedSchema: parsedSchema,
            schemaObj: schemaObj,
          }, false)
        }
      })

      // 2. Load the model object
      this.model = this.device.model

      // 3. Iterate through the model and create schema objects where they don't yet exist
      if (this.schema) {
        // Handle a race condition whereby the schema might not have loaded yet. In which case we use the schema watcher
        this.updateDynamicSchemaObjects()
      }
    },

    updateDynamicSchemaObjects () {

      /** This method goes through the model recursively and looks for Schema_UUIDs. If it finds one it works out where
       * it was found and checks the relative place in the Schema object to see if it's the child of a regex. If it is
       * then it won't have the required schema objects populated so we need to create them.
       **/

      // The nestingPointer array is used to keep track of where we are in the model
      let nestingPointer = []
      this.searchForSchemaUUID(this.model, nestingPointer)

    },

    searchForSchemaUUID (modelLevel, nestingPointer) {
      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.

      let n = nestingPointer.slice(0, -1).flatMap(e => ['properties', e])

      // If we have a Schema_UUID in here then create it first to avoid child before parent issues
      if (Object.keys(modelLevel).includes('Schema_UUID')) {
        if (modelLevel.Schema_UUID !== 'b16275f1-e443-4c41-a482-fcbdfbd20769') {

          // Work out what the object looks like for this model in the schema
          let nestedProperty = n.reduce((object, key) => object[key], this.schema)

          // If the nestedProperty has a patternProperties then we need to create the schema objects
          if (nestedProperty.patternProperties) {

            // Get the first key within nestedProperty.patternProperties that will be the regex
            let regexKey = Object.keys(nestedProperty.patternProperties)[0]

            // Get the content of that schema, which will be the object that we need to create
            let schemaToInstantiate = _.cloneDeep(nestedProperty.patternProperties[regexKey])

            // Get the last element of the nestingPointer which will be the name of the object to create
            let objectName = nestingPointer[nestingPointer.length - 1]

            // console.log('PatternProperties found. Creating', schemaToInstantiate.title, 'called', objectName ,'at', n.join('.'), schemaToInstantiate)

            // Create the object
            this.set(n.join('.') + '.properties.' + objectName, schemaToInstantiate, this.schema, '.')

            this.markDirty()
          }

        }
      }

      Object.keys(modelLevel).forEach(key => {

        if (key === 'Schema_UUID') {
          // We've already handled this above
          return
        }

        if (typeof modelLevel[key] === 'object') {
          // We've found an object so we need to go deeper
          nestingPointer.push(key)
          this.searchForSchemaUUID(modelLevel[key], nestingPointer)
          nestingPointer.pop()
        }
      })
    },

    applyMapping (mapping) {
      this.showCDSImport = false

      Object.keys(mapping).forEach(e => {
        this.set(mapping[e].schemaMapping.namePath.join('/'), this.renameKeys(mapping[e]), this.model, '/')
      })

      this.markDirty()
    },

    doSave (e) {
      if (!((e.keyCode === 83 && e.metaKey) || (e.keyCode === 83 && e.ctrlKey))) {
        return
      }

      e.preventDefault()
      this.save(false)
    },

    /**
     * This function takes the old CDS metric names and remaps them into ones understood by this schema editor.
     * It also checks that the Sparkplug type is valid and utilises the default if not.
     */
    renameKeys (e) {
      return {
        Address: e.metric.address ?? null,
        Deadband: e.metric.deadBand ?? null,
        Documentation: e.metric.docs ?? null,
        Eng_High: e.metric.engHigh ?? null,
        Eng_Low: e.metric.engLow ?? null,
        Eng_Unit: e.metric.engUnit ?? null,
        Method: e.metric.method ?? null,
        Path: e.metric.path ?? null,
        Record_To_Historian: e.metric.recordToDB ?? null,
        Sparkplug_Type: this.validateType(this.remapTypes(e.metric.type) ?? null, e),
        Value: e.metric.value ?? null,
      }
    },

    validateType (type, mapping) {

      // Get valid types from the schema
      let validTypes = mapping.schemaMapping.metric.properties.Sparkplug_Type.enum

      if (validTypes.includes(type)) {
        // If the type is valid, return it
        return type
      } else {
        // Set the first valid type as the default
        return validTypes[0]
      }
    },

    remapTypes (oldType) {

      switch (oldType) {
        case 'Boolean':
          return 'Boolean'

        case 'uInt8':
          return 'UInt16BE'
        case 'int8':
          return 'UInt16BE'

        case 'uInt16BE':
          return 'UInt16BE'
        case 'uInt16LE':
          return 'UInt16LE'
        case 'int16BE':
          return 'Int16BE'
        case 'int16LE':
          return 'Int16LE'

        case 'uInt32BE':
          return 'UInt32BE'
        case 'uInt32LE':
          return 'UInt32LE'
        case 'int32BE':
          return 'Int32BE'
        case 'int32LE':
          return 'Int32LE'

        case 'uInt64BE':
          return 'UInt64BE'
        case 'uInt64LE':
          return 'UInt64LE'
        case 'int64BE':
          return 'Int64BE'
        case 'int64LE':
          return 'Int64LE'

        case 'FloatBE':
          return 'FloatBE'
        case 'FloatLE':
          return 'FloatLE'

        case 'DoubleBE':
          return 'DoubleBE'
        case 'DoubleLE':
          return 'DoubleLE'

        case 'DateTime':
          return 'DateTime'
        case 'String':
          return 'String'
        case 'uuid':
          return 'UUID'
        case 'dataSet':
          return 'DataSet'
        case 'bytes':
          return 'Bytes'
        case 'file':
          return 'File'
        case 'Unknown':
          return 'Unknown'
        default:
          return 'String'
      }
    },

    newObject (val) {
      this.newObjectContext = [...val].reverse()
    },

    maybeDeleteObject (val) {
      window.showNotification({
        title: 'Are you sure?',
        description: `Are you sure you want to delete ${[...val].reverse().map(e => e.key).join('.')}?`,
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Delete', type: 'error', loadingOnClick: true, action: () => {
              this.deleteObject(val)
            },
          },
          { text: 'Cancel', isClose: true },
        ],
        id: 'f222b117-d9fb-463d-812a-c58f38f89459',
      })
    },

    deleteObject (val) {

      let deleteObjectContext = [...val].reverse().map(e => e.key)

      // Delete the entry from the model
      let lastKey = deleteObjectContext.pop()
      let nestedProperty = deleteObjectContext.reduce((object, key) => object[key], this.model)

      this.$delete(nestedProperty, lastKey)

      // Delete the entry from the schema
      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.

      let n = deleteObjectContext.flatMap(e => ['properties', e])

      // Work out what the object looks like for this model in the schema
      let nestedSchemaProperty = n.reduce((object, key) => object[key], this.schema)

      this.$delete(nestedSchemaProperty.properties, lastKey)

      if (Object.keys(nestedSchemaProperty.properties).length === 0) {
        this.$delete(nestedSchemaProperty, 'properties')
      }

      this.groupRerenderTrigger = +new Date()
      this.markDirty('Deleted Object')
      this.updateDynamicSchemaObjects()
      window.hideNotification({ id: 'f222b117-d9fb-463d-812a-c58f38f89459' })
    },

    /**
     * This function adds a new instance of an object represented in the schema by patternProperties.
     */
    createObject (name) {

      let regexKey = Object.keys(this.newObjectContext[this.newObjectContext.length - 1].value.patternProperties)[0]

      // This creates an empty object with Schema_UUID and Instance_UUID set at the specific location
      this.set(this.newObjectContext.map(e => e.key).join('.') + '.' + name, {
        Schema_UUID: this.newObjectContext[this.newObjectContext.length -
        1].value.patternProperties[regexKey].properties.Schema_UUID.const,
        Instance_UUID: uuidv4(),
      }, this.model, '.')

      this.newObjectContext = null
      this.groupRerenderTrigger = +new Date()
      this.markDirty('New Object')
      this.updateDynamicSchemaObjects()
    },

    selectMetric (val) {

      this.metricLoading = true

      let reversed = [...val].reverse()

      // Get the existing value
      let value = reversed.reduce((acc, curr) => acc && acc[curr.key], this.model)

      // Get the schema for this metric
      let metricSchema = {
        ...val[0].value.allOf[0].properties,
        ...val[0].value.allOf[1].properties,
      }

      // If the value is null or undefined then we need to create the model
      if (value === null || value === undefined) {

        // Check that the template is a valid Factory+ metric
        if (!('allOf' in val[0].value) || Object.keys(val[0].value).length !== 1 || val[0].value.allOf.length !== 2) {
          console.error(
              'Metric not configured correctly. It must be contained within an allOf and have a second element specifying the Sparkplug type and other overloads. See the Factory+ Schema definition for more information.',
              val[0].value, reversed.map(e => e.key).join('.'))
          return
        }

        let newMetric = {}

        Object.keys(metricSchema).forEach(e => {

          // e.g. e = Documentation

          if ('default' in metricSchema[e]) {
            // If we have a default value then set it
            newMetric[e] = metricSchema[e].default
          } else if ('enum' in metricSchema[e]) {
            // If we have an enum then set the first value
            newMetric[e] = metricSchema[e].enum[0]
          } else {
            // Otherwise delete it
            delete newMetric[e]
          }
        })

        // Set the new metric defaults in the model
        this.set(reversed.map(e => e.key).join('.'), newMetric, this.model, '.')

        // Ensure that the Schema_UUID and Instance_UUID are set on every model in the chain where required.
        // console.log(reversed) will show the incoming payload and will make this more clear.
        reversed.forEach((e, index) => {
          // If this entry in the chain has a Schema_UUID and the model doesn't have one yet then stamp it on
          if (e.schemaUUID &&
              !reversed.slice(0, index + 1).reduce((acc, curr) => acc && acc[curr.key]?.Schema_UUID, this.model)) {
            // If this entry in the chain has a Schema_UUID then stamp that onto the model, using this and all of the elements before
            this.set(reversed.slice(0, index + 1).map(e => e.key).join('.') + '.Schema_UUID', e.schemaUUID, this.model,
                '.')

            // Generate an Instance_UUID for this schema instance, only if we're stamping this for the first time and it's not a metric
            if (e.schemaUUID !== 'b16275f1-e443-4c41-a482-fcbdfbd20769') {
              this.set(reversed.slice(0, index + 1).map(e => e.key).join('.') + '.Instance_UUID', uuidv4(), this.model,
                  '.')
            }
          }
        })

        // Then go and fetch it and return it
        this.selectedMetric = {
          path: reversed.map(e => e.key),
          model: newMetric,
          schema: metricSchema,
        }
      } else {
        // Otherwise we have an existing metric so just return it
        this.selectedMetric = {
          path: reversed.map(e => e.key),
          model: value,
          schema: metricSchema,
        }
      }

      this.rerenderTrigger = +new Date()
    },

    metricDetailsEdited (val) {
      this.markDirty('Metric edited')
    },

    markDirty () {
      this.isDirty = true
    },

    prepareModelForSaving () {
      // Set the top level Schema_UUID
      this.model.Schema_UUID = this.schema.properties.Schema_UUID.const

      // Set the top level Instance_UUID if it doesn't already exist
      if (!this.model.Instance_UUID) {
        this.set('Instance_UUID', uuidv4(), this.model)
      }

    },

    set (path, toValue, onObject, delimiter = '.') {
      let schema = onObject  // a moving reference to internal objects within obj
      const pList = path.split(delimiter)
      const len = pList.length

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i]
        if (!schema[elem]) schema[elem] = {}
        schema = schema[elem]
      }
      this.$set(schema, pList[len - 1], toValue)
    },

    unset (path, onObject) {
      let schema = onObject  // a moving reference to internal objects within obj
      const pList = path.split('.')
      const len = pList.length

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i]
        if (!schema[elem]) schema[elem] = {}
        schema = schema[elem]
      }
      delete schema[pList[len - 1]]
    },

    selectSchema (schema) {
      this.schemaBrowserVisible = false
      this.schema = schema.parsedSchema
      this.selectedSchemaId = schema.schemaObj.device_schema_id
      this.selectedSchemaVersionId = schema.schemaObj.device_schema_version_id
      this.loadingExistingConfig = false
    },

    save (activate) {
      if (this.loading) {
        return
      }
      this.loading = true

      this.prepareModelForSaving()

      axios.patch(`/api/devices/${this.device.id}/origin-map`, {
        'configuration': JSON.stringify(this.model),
        'activate': activate,
        'device_schema_id': this.selectedSchemaId,
        'device_schema_version_id': this.selectedSchemaVersionId,
      }).then(() => {
        this.loading = false
        this.isDirty = false
        this.$emit('close')
        this.requestDataReloadFor('device')
        this.requestDataReloadFor('deviceConnections')
        this.selectedMetric = null
        window.showNotification({
          title: 'Saved',
          description: 'The configuration has been saved.',
          type: 'success',
        })
      }).catch(error => {
        this.loading = false
        this.markDirty('Save failed')
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login')
        }
        this.handleError(error)
      })

    },
  },

  data () {
    return {
      isDirty: false,
      loadingExistingConfig: true,
      refParser: $RefParser,
      loading: false,
      selectedMetric: null,
      groupRerenderTrigger: +new Date(),
      rerenderTrigger: +new Date(),
      model: {},
      schemaBrowserVisible: false,
      schema: null,
      selectedSchemaId: null,
      selectedSchemaVersionId: null,
      showCDSImport: false,
      controls: [],

      newObjectContext: null,
      metricLoading: false,
    }
  },
}
</script>


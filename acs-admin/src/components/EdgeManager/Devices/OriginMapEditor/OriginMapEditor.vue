<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <!-- Wrapper div with fixed height and no scrolling -->
  <div class="w-full overflow-hidden flex-1">
    <SidebarProvider class="overflow-hidden">
    <Dialog :open="!!newObjectContext" @update:open="(open) => { if (!open) newObjectContext = null }">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle v-if="newObjectContext && newObjectContext.length">
            Add a new entry to {{ newObjectContext[0].key }}
          </DialogTitle>
          <DialogDescription>Create a new item in this section</DialogDescription>
        </DialogHeader>
        <NewObjectOverlayForm
            @create="createObject"
            @close="newObjectContext = null"
            v-if="newObjectContext && newObjectContext[newObjectContext.length-1]?.value?.patternProperties"
            :object-type="newObjectContext && newObjectContext.length ? newObjectContext[0].key : 'Object'"
            :regex="Object.keys(newObjectContext[newObjectContext.length-1]?.value?.patternProperties || {})[0] || '.*'"></NewObjectOverlayForm>
      </DialogContent>
    </Dialog>
      <!-- Sidebar with fixed height and independent scrolling -->
      <Sidebar collapsible="none" class="flex flex-col ml-3 my-3 bg-gray-100/50 border rounded-lg">
        <SidebarContent class="flex flex-col h-auto">
          <!-- Schema tree with independent scrolling -->
          <SidebarGroup class="h-auto overflow-hidden flex-1">
            <SidebarGroupContent class="overflow-auto h-auto">
              <SidebarMenu>
                <SchemaGroup v-if="schema" :key="groupRerenderTrigger"
                    @selected="selectMetric"
                    @newObject="newObject"
                    @deleteObject="maybeDeleteObject"
                    @toggle-show-only-populated="handleToggleShowOnlyPopulated"
                    class="overflow-x-auto border-l-0"
                    :schema="schema"
                    :selected-metric="selectedMetric"
                    :model="model"
                    :show-only-populated="showOnlyPopulated">
                </SchemaGroup>
              </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
          <!-- Save button fixed at the bottom -->
          <Button variant="destructive" :disabled="loading" @click="save()" class="mt-2 shrink-0 m-3">
          <div v-if="!loading" class="flex items-center justify-center gap-1">
            <span>Save Changes</span>
            <i class="fa-sharp fa-solid fa-save ml-2"></i>
          </div>
          <div v-else class="flex items-center justify-center gap-1">
            <span>Saving</span>
            <i class="fa-sharp fa-solid fa-circle-notch fa-spin ml-2"></i>
          </div>
        </Button>
      </SidebarContent>
      <SidebarRail/>
    </Sidebar>
      <!-- Main content with fixed height and independent scrolling -->
      <SidebarInset class="flex flex-col flex-1 overflow-hidden px-6 pt-4 h-full">
        <!-- Fixed header -->
      <header class="flex shrink-0 items-center justify-between gap-2 px-1 mb-3">
          <Breadcrumb>
            <BreadcrumbList>
              <template v-if="selectedMetric">
                <template v-for="(segment, index) in selectedMetric.path.slice(0, -1)" :key="index">
                  <BreadcrumbItem class="hidden md:block">
                    <BreadcrumbLink>
                      {{segment}}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator class="hidden md:block"/>
                </template>
                <BreadcrumbItem>
                  <BreadcrumbPage>{{selectedMetric.path.slice(-1)[0]}}</BreadcrumbPage>
                </BreadcrumbItem>
              </template>
            </BreadcrumbList>
          </Breadcrumb>
        <div class="text-xs text-gray-400/90">{{selectedMetric?.model.Documentation}}</div>
      </header>
        <!-- Scrollable content area -->
        <div class="flex-1 content-scroll">
        <div v-if="selectedMetric">
          <SparkplugMetric :key="rerenderTrigger"
              :selected-metric="selectedMetric" :model="model"
              :schema="sparkplugMetricSchema.schema"
              :connection="device.deviceInformation?.connection"
              @input="metricDetailsEdited"
              @remove-metric="removeMetric">
          </SparkplugMetric>
        </div>
        <div v-else class="flex items-center justify-center h-full">
          <div class="text-center">
            <i class="fas fa-tag fa-2x text-gray-500"></i>
            <h3 class="mt-2 text-sm font-medium text-gray-700">No Metric Selected</h3>
            <p class="mt-1 text-sm text-gray-400">Click on a metric on the left to configure it.</p>
          </div>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
  </div>
</template>
<script>
import { v4 as uuidv4 } from 'uuid'
import { useSchemaStore } from '@store/useSchemaStore.js'
import SchemaGroup from './SchemaGroup.vue'
import SparkplugMetric from './SparkplugMetric.vue'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { storeReady } from '@store/useStoreReady.js'
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useConnectionStore } from '@store/useConnectionStore.js'
import _ from 'lodash'
import NewObjectOverlayForm from './NewObjectOverlayForm.vue'
import { updateEdgeAgentConfig } from '@/utils/edgeAgentConfigUpdater'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar'
import { File } from 'lucide-vue-next'
import Tree from './Tree.vue'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'

const SparkplugMetricUUID = 'b16275f1-e443-4c41-a482-fcbdfbd20769'

export default {

  setup () {

    return {
      sch: useSchemaStore(),
      s: useServiceClientStore(),
      conn: useConnectionStore(),
    }
  },

  props: {
    device: { required: true },
    deviceSchema: {
      required: true,
      type: Object,
    },
  },

  components: {
    SchemaGroup,
    SparkplugMetric,
    Button,
    NewObjectOverlayForm,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    SidebarHeader,
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    Separator,
    File,
    Tree,
  },

  mounted () {
    // Prevent the window from reloading if we have a dirty state
    window.onbeforeunload = this.checkDirty

    document.addEventListener('keydown', this.doSave)

    // Load the showOnlyPopulated preference from localStorage
    const savedShowOnlyPopulated = localStorage.getItem('showOnlyPopulated');
    if (savedShowOnlyPopulated !== null) {
      this.showOnlyPopulated = savedShowOnlyPopulated === 'true';
    }

    // Start the connection store
    this.conn.start()
  },

  computed: {
    sparkplugMetricSchema () {
      return this.sch.data.find(e => e.uuid === SparkplugMetricUUID)
    },
  },
  watch: {
    // If the schema changes (including on load), build up the schema
    // and load the existing config
    'deviceSchema.uuid': {
      immediate: true,
      async handler(schemaUuid) {
        if (schemaUuid) {
          try {
            console.debug('Looking for schema', `urn:uuid:${schemaUuid}`)
            // Remove the "urn:uuid:" prefix here since dereference will add it
            this.schema = await this.dereference(schemaUuid)
            this.loadExistingConfig()
          }
          catch (error) {
            console.error('Failed to resolve schema:', error)
          }
        }
      }
    },

    // Watch for changes to the origin map in device information
    'device.deviceInformation.originMap': {
      immediate: true,
      handler(newOriginMap) {
        console.debug('Origin map changed:', newOriginMap)
        // If the origin map is null or undefined, reset our model
        if (newOriginMap === null || newOriginMap === undefined) {
          console.debug('Resetting origin map model')
          this.resetModel()
          // Trigger a re-render of the schema group
          this.groupRerenderTrigger = +new Date()
        }
      }
    }
  },

  beforeDestroy () {
    document.removeEventListener('keydown', this.doSave)
  },

  methods: {

    async dereference (schemaUuid) {
      const parser = {
        order: 1,
        canParse: true,
        parse: file => file.data,
      }

      const resolver = {
        order: 1,
        canRead: /^urn:uuid\/?:[-0-9a-f]{36}$/,
        read: async (file) => {
          console.debug('Reading file', file.url)
          const uuid = file.url.replace(/^urn:uuid\/?:/, '')
          console.debug('Waiting for schema store to be ready...')
          await storeReady(this.sch)
          console.debug('Schema store is ready')
          console.debug('Looking for schema in store', uuid)
          const found = this.sch.data.find(s => s.uuid === uuid)
          console.debug('Found schema', found)
          return found.schema
        },
      }

      const rp        = new $RefParser()
      // Remove the prefix if it's already there
      const cleanUuid = schemaUuid.replace(/^urn:uuid:/, '')
      return rp.dereference(`urn:uuid:${cleanUuid}`, {
        parse: { all: parser },
        resolve: {
          uuid: resolver,
          file: false,
          http: false,
        },
      })
    },

    checkDirty () {
      if (this.isDirty) {
        return ''
      }
    },

    loadExistingConfig () {

      this.loadingExistingConfig = true

      if (!this.device.deviceInformation.originMap) {
        // Reset the model to an empty object if there's no origin map
        this.resetModel()
        this.loadingExistingConfig = false
        return
      }

      // Load the model
      this.model = this.device.deviceInformation.originMap

      // Iterate through the model and create schema objects where they don't yet exist
      this.updateDynamicSchemaObjects()

      this.loadingExistingConfig = false
    },

    updateDynamicSchemaObjects () {

      /** This method goes through the model recursively and looks for
       * Schema_UUIDs. If it finds one it works out where it was found
       * and checks the relative place in the Schema object to see if
       * it's the child of a regex. If it is then it won't have the
       * required schema objects populated so we need to create them.
       * */

        // The nestingPointer array is used to keep track of where we are in the model
      let nestingPointer = []
      this.searchForSchemaUUID(this.model, nestingPointer)

    },

    selectSchema (schema) {
      this.schema                = schema.parsedSchema
      this.loadingExistingConfig = false
    },

    searchForSchemaUUID (modelLevel, nestingPointer) {
      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.

      let n = nestingPointer.slice(0, -1).flatMap(e => ['properties', e])

      // Get the last element of the nestingPointer which will be the name of the object to create
      let objectName = nestingPointer[nestingPointer.length - 1]

      if (// Make sure modelLevel is an object
        modelLevel && typeof modelLevel === 'object' &&
        // If we have a Schema_UUID in here then create it first to avoid child before parent issues
        Object.keys(modelLevel).includes('Schema_UUID')

        // Do not process this if it's a metric schema
        && modelLevel.Schema_UUID !== SparkplugMetricUUID

        // Do not process this if it's already been added to the schema object
        && !_.get(this.schema, n.join('.') + '.properties.' + objectName)) {

        // Work out what the object looks like for this model in the schema
        let nestedProperty = n.reduce((object, key) => object && object[key], this.schema)

        // If the nestedProperty exists and has patternProperties then we need to create the schema objects
        if (nestedProperty && nestedProperty.patternProperties) {

          // Get the first key within nestedProperty.patternProperties that will be the regex
          let patternProps = nestedProperty.patternProperties || {}
          let regexKey = Object.keys(patternProps)[0]

          // Get the content of that schema, which will be the object that we need to create
          let schemaToInstantiate = regexKey ? _.cloneDeep(nestedProperty.patternProperties[regexKey]) : {}

          // Only call removePropertiesWithPatternProperties if properties exists
          if (schemaToInstantiate && schemaToInstantiate.properties) {
            this.removePropertiesWithPatternProperties(schemaToInstantiate.properties)
          }

          // console.log('PatternProperties found. Creating', schemaToInstantiate.title, 'called', objectName, 'at',
          //     n.join('.'), schemaToInstantiate)

          // Only create the object if we have a valid schema to instantiate
          if (schemaToInstantiate && Object.keys(schemaToInstantiate).length > 0) {
            // Create the object
            this.set(n.join('.') + '.properties.' + objectName, schemaToInstantiate, this.schema, '.')
            this.markDirty()
          }

        }

      }

      // Make sure modelLevel is an object before iterating
      if (modelLevel && typeof modelLevel === 'object') {
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
      }
    },

    removePropertiesWithPatternProperties (obj) {
      if (typeof obj !== 'object' || obj === null) {
        return
      }

      if (obj.properties && obj.patternProperties) {
        delete obj.properties
      }

      for (const key in obj) {
        if (key !== 'properties') {
          this.removePropertiesWithPatternProperties(obj[key])
        }
      }
    },

    doSave (e) {
      if (!((e.keyCode === 83 && e.metaKey) || (e.keyCode === 83 && e.ctrlKey))) {
        return
      }

      e.preventDefault()
      this.save()
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
      }
      else {
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
      const path = [...val].reverse().map(e => e.key).join('.')

      toast.warning('Delete object?', {
        description: `Are you sure you want to delete ${path}? This action cannot be undone.`,
        duration: 5000,
        closeButton: true,
        action: {
          label: 'Delete',
          onClick: () => {
            try {
              this.deleteObject(val)
              toast.success('Success!', {
                description: 'The object has been deleted successfully.',
              })
            }
            catch (err) {
              console.error('Failed to delete object:', err)
              toast.error('Unable to delete object', {
                description: 'There was a problem deleting the object.',
                action: {
                  label: 'Try again',
                  onClick: () => this.maybeDeleteObject(val),
                },
              })
            }
          }
        }
      })
    },

    deleteObject (val) {

      let deleteObjectContext = [...val].reverse().map(e => e.key)

      // Delete the entry from the model
      let lastKey        = deleteObjectContext.pop()
      let nestedProperty = deleteObjectContext.reduce((object, key) => object[key], this.model)

      // Replace this.$delete with delete operator
      delete nestedProperty[lastKey]

      // Delete the entry from the schema
      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.

      let n = deleteObjectContext.flatMap(e => ['properties', e])

      // Work out what the object looks like for this model in the schema
      let nestedSchemaProperty = n.reduce((object, key) => object[key], this.schema)

      // Replace this.$delete with delete operator
      delete nestedSchemaProperty.properties[lastKey]

      if (Object.keys(nestedSchemaProperty.properties).length === 0) {
        delete nestedSchemaProperty.properties
      }

      this.groupRerenderTrigger = +new Date()
      this.markDirty('Deleted Object')
      this.updateDynamicSchemaObjects()
    },

    /**
     * This function adds a new instance of an object represented in the schema by patternProperties.
     */
    createObject (name) {
      if (!this.newObjectContext || !this.newObjectContext.length) {
        console.error('Cannot create object: newObjectContext is null or empty');
        return;
      }

      const lastContext = this.newObjectContext[this.newObjectContext.length - 1];
      if (!lastContext || !lastContext.value || !lastContext.value.patternProperties) {
        console.error('Cannot create object: invalid context structure');
        return;
      }

      const patternProperties = lastContext.value.patternProperties;
      const regexKeys = Object.keys(patternProperties);
      if (!regexKeys.length) {
        console.error('Cannot create object: no pattern properties found');
        return;
      }

      const regexKey = regexKeys[0];
      const schemaUUID = patternProperties[regexKey]?.properties?.Schema_UUID?.const;
      if (!schemaUUID) {
        console.error('Cannot create object: Schema_UUID not found in pattern properties');
        return;
      }

      // Store the current toggle state from localStorage before making changes
      const toggleStateKey = `toggleState-${this.model.Instance_UUID || 'unknown'}`;
      let currentToggleState = null;
      try {
        const storedState = localStorage.getItem(toggleStateKey);
        if (storedState) {
          currentToggleState = JSON.parse(storedState);
        }
      } catch (e) {
        console.warn('Failed to parse toggle state from localStorage', e);
      }

      // This creates an empty object with Schema_UUID and Instance_UUID set at the specific location
      const path = this.newObjectContext.map(e => e.key).join('.') + '.' + name;
      this.set(path, {
        Schema_UUID: schemaUUID,
        Instance_UUID: uuidv4(),
      }, this.model, '.')

      // Update the model and schema
      this.updateDynamicSchemaObjects()

      // Trigger re-render after a short delay to ensure the DOM has updated
      setTimeout(() => {
        // Ensure the parent section stays expanded
        const parentPath = this.newObjectContext.map(e => e.key).join('.');

        // If we have stored toggle state, make sure the parent path is marked as expanded
        if (currentToggleState) {
          // Find if the parent path exists in the toggle state
          const parentIndex = currentToggleState.findIndex(item => {
            const [itemPath] = item.split(':state=');
            return itemPath === parentPath;
          });

          if (parentIndex !== -1) {
            // Update to ensure it's expanded
            currentToggleState[parentIndex] = `${parentPath}:state=open`;
          } else {
            // Add it as expanded
            currentToggleState.push(`${parentPath}:state=open`);
          }

          // Save back to localStorage
          localStorage.setItem(toggleStateKey, JSON.stringify(currentToggleState));
        }

        // Clear the context and trigger re-render
        this.newObjectContext = null
        this.groupRerenderTrigger = +new Date()
        this.markDirty('New Object')
      }, 50);
    },

    selectMetric (val) {
      let reversed = [...val].reverse()

      // Get the existing value
      let value = reversed.reduce((acc, curr) => acc && acc[curr.key], this.model)

      // Get the schema for this metric
      let metricSchema = {
        ...val[0].value.allOf[0].properties, ...val[0].value.allOf[1].properties,
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
          }
          else if ('enum' in metricSchema[e]) {
            // If we have an enum then set the first value
            newMetric[e] = metricSchema[e].enum[0]
          }
          else {
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
          if (e.schemaUUID && !reversed.slice(0, index + 1).reduce((acc, curr) => acc && acc[curr.key]?.Schema_UUID, this.model)) {
            // If this entry in the chain has a Schema_UUID then stamp that onto the model, using this and all of the elements before
            this.set(reversed.slice(0, index + 1).map(e => e.key).join('.') + '.Schema_UUID', e.schemaUUID, this.model, '.')

            // Generate an Instance_UUID for this schema instance, only if we're stamping this for the first time and it's not a metric
            if (e.schemaUUID !== SparkplugMetricUUID) {
              this.set(reversed.slice(0, index + 1).map(e => e.key).join('.') + '.Instance_UUID', uuidv4(), this.model, '.')
            }
          }
        })

        // Then go and fetch it and return it
        this.selectedMetric = {
          path: reversed.map(e => e.key),
          model: newMetric,
          schema: metricSchema,
        }
      }
      else {
        // Otherwise we have an existing metric so just return it
        this.selectedMetric = {
          path: reversed.map(e => e.key),
          model: value,
          schema: metricSchema,
        }
      }

      // Update the toggle state in localStorage to ensure parent objects are expanded
      // This is done after setting selectedMetric so that the SchemaGroup component can use it
      // to determine which objects should be expanded
      this.ensureParentObjectsExpanded(reversed.map(e => e.key));

      this.rerenderTrigger = +new Date()
    },

    ensureParentObjectsExpanded(path) {
      // This method ensures that all parent objects of the selected metric are expanded
      // It updates the toggle state in localStorage directly, which will be read by the SchemaGroup component
      if (!path || path.length === 0) return;

      const toggleStateKey = `toggleState-${this.model.Instance_UUID || 'unknown'}`;
      let currentToggleState;

      try {
        const storedState = localStorage.getItem(toggleStateKey);
        currentToggleState = storedState ? JSON.parse(storedState) : [];
      } catch (e) {
        console.warn('Failed to parse toggle state from localStorage', e);
        currentToggleState = [];
      }

      // For each level in the path, ensure it's expanded in the toggle state
      let pathSoFar = [];
      for (let i = 0; i < path.length - 1; i++) { // Skip the last one which is the metric itself
        pathSoFar.push(path[i]);
        const parentPath = pathSoFar.join('.');

        // Find if the parent path exists in the toggle state
        const parentIndex = currentToggleState.findIndex(item => {
          const [itemPath] = item.split(':state=');
          return itemPath === parentPath || itemPath.endsWith(`:${parentPath}`);
        });

        if (parentIndex !== -1) {
          // Update to ensure it's expanded
          currentToggleState[parentIndex] = `${parentPath}:state=open`;
        } else {
          // Add it as expanded
          currentToggleState.push(`${parentPath}:state=open`);
        }
      }

      // Save back to localStorage
      localStorage.setItem(toggleStateKey, JSON.stringify(currentToggleState));
    },

    metricDetailsEdited (val) {
      this.markDirty('Metric edited')
    },

    removeMetric (path) {
      // Remove the metric from the model
      let currentObj = this.model;
      for (let i = 0; i < path.length - 1; i++) {
        if (!currentObj || typeof currentObj !== 'object') return;
        currentObj = currentObj[path[i]];
      }

      // Delete the metric
      if (currentObj && typeof currentObj === 'object') {
        delete currentObj[path[path.length - 1]];
        this.markDirty('Metric removed');

        // Clear the selected metric
        this.selectedMetric = null;

        // Trigger a re-render of the schema group
        this.groupRerenderTrigger = +new Date();
      }
    },

    handleToggleShowOnlyPopulated(value) {
      this.showOnlyPopulated = value;

      // Trigger a re-render of the schema group to ensure the UI updates
      this.groupRerenderTrigger = +new Date();
    },

    markDirty () {
      this.isDirty = true
    },

    resetModel() {
      // Reset the model to an empty object
      this.model = {}
      // Clear the selected metric
      this.selectedMetric = null
      // Reset the dirty state
      this.isDirty = false
    },

    prepareModelForSaving () {

      // Set the top level Schema_UUID
      this.model.Schema_UUID = this.deviceSchema.uuid

      // Set the top level Instance_UUID if it doesn't already exist
      if (!this.model.Instance_UUID) {
        this.set('Instance_UUID', uuidv4(), this.model)
      }

    },

    set (path, toValue, onObject, delimiter = '.') {
      let schema  = onObject  // a moving reference to internal objects within obj
      const pList = path.split(delimiter)
      const len   = pList.length

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i]
        if (!schema[elem]) schema[elem] = {}
        schema = schema[elem]
      }

      // Direct assignment works in Vue 3
      schema[pList[len - 1]] = toValue
    },

    unset (path, onObject) {
      let schema  = onObject  // a moving reference to internal objects within obj
      const pList = path.split('.')
      const len   = pList.length

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i]
        if (!schema[elem]) schema[elem] = {}
        schema = schema[elem]
      }
      delete schema[pList[len - 1]]
    },

    validateModel() {
      // Create a new Ajv instance
      const ajv = new Ajv({ allErrors: true, strictTypes: false });
      // Add format validators
      addFormats(ajv);
      // Add vocabulary for schema keywords that aren't strictly part of validation
      ajv.addVocabulary(['options', 'headerTemplate', 'links']);

      try {
        // Compile the schema
        const validate = ajv.compile(this.schema);

        // Validate the model against the schema
        const valid = validate(this.model);

        if (!valid) {
          // Format validation errors for display
          const errors = validate.errors.map(error => {
            const path = error.instancePath || 'root';
            return `${path}: ${error.message}`;
          });

          return {
            valid: false,
            errors: errors
          };
        }

        return { valid: true };
      } catch (err) {
        console.error('Schema validation error:', err);
        return {
          valid: false,
          errors: [`Schema validation failed: ${err.message}`]
        };
      }
    },

    async save () {
      if (this.loading) {
        return
      }
      this.loading = true

      this.prepareModelForSaving()

      // Validate the model against the schema
      const validation = this.validateModel();
      if (!validation.valid) {
        this.loading = false;

        // Show validation errors to the user
        toast.error('Validation failed', {
          description: 'The origin map contains errors that need to be fixed.',
          action: {
            label: 'View Errors',
            onClick: () => {
              // Display the errors in a more readable format
              console.error('Validation errors:', validation.errors);

              // Show the first few errors to the user
              const firstErrors = validation.errors.slice(0, 3);
              firstErrors.forEach(error => {
                toast.error('Validation Error', {
                  description: error,
                  duration: 5000
                });
              });

              if (validation.errors.length > 3) {
                toast.error('Additional Errors', {
                  description: `${validation.errors.length - 3} more errors found. Check the console for details.`,
                  duration: 5000
                });
              }
            }
          }
        });
        return;
      }

      // Patch the Device Information application
      try {
        await this.s.client.ConfigDB.patch_config(UUIDs.App.DeviceInformation, this.device.uuid, "merge", { originMap: this.model })

        // BUG HERE - USES OLD CONFIG. MAKE SURE THAT updateEdgeAgentConfig refreshes all stores when it's called

        await updateEdgeAgentConfig({
          deviceId: this.device.uuid
        })

        this.loading = false
        this.isDirty = false
        toast.success('Origin Map updated successfully')
      }
      catch (err) {
        this.loading = false
        toast.error('Unable to update Origin Map')
        console.error(err)
      }
    },

  },

  data () {
    return {
      schema: null,
      isDirty: false,
      loadingExistingConfig: false,
      loading: false,
      selectedMetric: null,
      groupRerenderTrigger: +new Date(),
      rerenderTrigger: +new Date(),
      model: {},
      schemaBrowserVisible: false,
      showCDSImport: false,
      controls: [],
      showOnlyPopulated: false,

      newObjectContext: null,
    }
  },
}
</script>

<style scoped>
/* Apply these styles to the component's root element */
:deep(html), :deep(body), :deep(#app) {
    height: 100%;
    overflow: hidden;
}

/* Ensure the component takes up the full height */
.h-full {
    height: 100%;
}

/* Ensure scrollable areas have proper overflow behavior */
.overflow-auto {
    overflow: auto;
}

/* Prevent overflow on containers */
.overflow-hidden {
    overflow: hidden;
}
</style>


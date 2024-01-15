<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col gap-2 flex-1" :class="guides ? '' : 'overflow-y-auto'">
    <div v-if="guides" class="absolute w-0.5 left-6 top-[3.25rem] bottom-7 bg-gray-300 group-last:h-0"></div>
    <div v-for="name in sortedKeys" class="relative group text-left overflow-visible">
      <div v-if="guides" class="absolute h-0.5 w-4 -left-4 top-6 bg-gray-300"></div>
      <div v-if="name === 'Schema_UUID'" class="flex items-center gap-3 border-2 bg-gray-100">
        <div v-tooltip="'Schema UUID'"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-tag text-sm"></i>
        </div>
        <div class="flex">
          <div>Schema_UUID</div>
        </div>
      </div>
      <div v-else-if="name === 'Instance_UUID'" class="flex items-center gap-3 border-2 bg-gray-100">
        <div v-tooltip="'Instance UUID'"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-tag text-sm"></i>
        </div>
        <div class="flex">
          <div>Instance_UUID</div>
        </div>
      </div>
      <button @click.stop="clicked({type: 'metric', name: name, property: properties[name]})"
              class="flex items-center gap-3 border-2 w-full active:bg-gray-100 hover:bg-gray-50 text-left"
              v-else-if="isMetric(properties[name])">
        <div v-tooltip="getMetricData(properties[name]).types[0]"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-fw text-sm" :class="getMetricData(properties[name]).icon"></i>
        </div>
        <div class="flex w-full items-center">
          <div>{{name}}</div>
          <button @click.stop="maybeDelete(properties[name])"
                  class="ml-auto flex items-center justify-center w-10 h-10 text-gray-200 hover:text-red-500">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </button>
      <button
          @click.stop="clicked({type: 'folder', name: name, property: properties[name]})"
          class="flex items-center gap-3 border-2 w-full active:bg-gray-100 hover:bg-gray-50 text-left"
          v-else-if="isSchema(properties[name])">
        <div v-tooltip="properties[name].$ref"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-fw text-sm fa-cube"></i>
        </div>
        <div class="flex flex-col">
          <div>{{name}}</div>
          <div class="text-xs text-gray-500 truncate">{{
              properties[name].$ref.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', '')
            }}
          </div>
        </div>
        <button @click.stop="maybeDelete(properties[name])"
                class="ml-auto flex items-center justify-center w-10 h-10 text-gray-200 hover:text-red-500">
          <i class="fa-solid fa-trash"></i>
        </button>
      </button>
      <button
          @click.stop="clicked({type: 'folder', name: name, property: properties[name]})"
          class="flex items-center gap-3 border-2 w-full active:bg-gray-100 hover:bg-gray-50 text-left"
          v-else-if="isSchemaArray(properties[name])">
        <div
            v-tooltip="`Array of ${properties[name].patternProperties[Object.keys(properties[name].patternProperties)[0]].$ref}`"
            class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-fw text-sm fa-cubes"></i>
        </div>
        <div class="flex w-full">
          <div class="flex flex-col">
            <div>{{name}}</div>
            <div class="text-xs text-gray-500 truncate">{{
                properties[name].patternProperties[Object.keys(properties[name].patternProperties)[0]].$ref.replace(
                    'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/', '')
              }}
            </div>
          </div>
          <button @click.stop="maybeDelete(properties[name])"
                  class="ml-auto flex items-center justify-center w-10 h-10 text-gray-200 hover:text-red-500">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </button>
      <div v-else-if="isFolder(properties[name])"
           @click.stop="clicked({type: 'folder', name: name, property: properties[name]})">
        <button class="flex items-center gap-3 border-2 mb-3 w-full active:bg-gray-100 hover:bg-gray-50 text-left">
          <div v-tooltip="'Folder'"
               class="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
            <i class="fa-solid fa-fw text-sm fa-folder"></i>
          </div>
          <div class="flex">
            <div>{{name}}</div>
          </div>
          <button @click.stop="maybeDelete(properties[name])"
                  class="ml-auto flex items-center justify-center w-10 h-10 text-gray-200 hover:text-red-500">
            <i class="fa-solid fa-trash"></i>
          </button>
        </button>
        <List @rowSelected=" (e) => $emit('rowSelected', e)" @rowDeleted=" (e) => $emit('rowDeleted', e)"
              @new="(e) => $emit('new', e)" class="ml-10"
              :properties="properties[name].properties" :uuid="properties[name].uuid"></List>
      </div>
      <div v-else>
        BAD FORMAT
      </div>
    </div>
    <OverflowMenu class="col-span-5"
                  :options="newItemOptions">
      <button type="button"
              class="fpl-button-secondary m-1 h-10">
        <div class="mr-2">Add</div>
        <i class="fa-sharp fa-solid fa-plus text-xs"></i>
      </button>
    </OverflowMenu>
  </div>
</template>

<script>
import { v4 as uuidv4 } from 'uuid'

export default {
  name: 'List',

  props: {
    /**
     * The object containing all properties to iterate through
     */
    properties: {
      required: true,
      type: Object,
    },

    /**
     * The uuid of this folder
     */
    uuid: {
      required: false,
      type: String,
    },

    /**
     * Whether or not to show the vertical guides for nested items
     */
    guides: {
      required: false,
      type: Boolean,
      default: true,
    },
  },

  components: {
    'List': () => import(/* webpackPrefetch: true */ './List.vue'),
  },

  computed: {
    sortedKeys () {
      return Object.keys(this.properties).sort((a, b) => {
        return this.properties[a].index - this.properties[b].index
      })
    },
  },

  methods: {

    clicked (e) {
      this.$emit('rowSelected',
          { type: e.type, payload: { name: e.name, uuid: e.property.uuid, property: e.property } })
    },

    maybeDelete (e) {
      window.showNotification({
        title: 'Are you sure?',
        description: 'This will delete the selected item and all of its children',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Delete', type: 'error', loadingOnClick: true, action: () => {
              window.hideNotification({ id: 'e81f631d-e78c-40c1-9536-e5210ca3fbbd' })
              this.$emit('rowDeleted', { uuid: e.uuid })
            },
          },
          { text: 'Cancel', isClose: true },
        ],
        id: 'e81f631d-e78c-40c1-9536-e5210ca3fbbd',
      })
    },

    checkIfObject (input) {
      // First, check if the variable is not null, and its typeof returns 'object'
      // Then check if it is not an instance of Array, since arrays in JavaScript are also objects
      return input !== null && typeof input === 'object' && !(input instanceof Array)
    },

    isMetric (property) {
      return this.checkIfObject(property) && 'allOf' in property && property.allOf.length === 2 &&
          (new RegExp('Common\/Metric-v\\d\.json')).test(property.allOf[0].$ref)
    },

    getMetricData (property) {
      return {
        types: property.allOf[1].properties.Sparkplug_Type.enum,
        icon: `fa-${property.allOf[1].properties.Sparkplug_Type.enum?.[0]?.[0].toLowerCase() ||
        'question text-red-500'}`,
        documentation: property.allOf[1].properties.Documentation.default,
        unit: property.allOf[1].properties.Eng_Unit?.default,
        low: property.allOf[1].properties.Eng_Low?.default,
        high: property.allOf[1].properties.Eng_High?.default,
        recordToHistorian: property.allOf[1].properties.Record_To_Historian?.default,
      }
    },

    isSchema (property) {
      return this.checkIfObject(property)
          && '$ref' in property
          && typeof property.$ref === 'string'
          && (new RegExp('-v\\d\.json')).test(property.$ref)
    },

    isSchemaArray (property) {
      return this.checkIfObject(property)
          && 'type' in property
          && 'patternProperties' in property
          && Object.keys(property.patternProperties).length === 1
          && '$ref' in property.patternProperties[Object.keys(property.patternProperties)[0]]
          && typeof property.patternProperties[Object.keys(property.patternProperties)[0]].$ref === 'string'
          &&
          (new RegExp('-v\\d\.json')).test(property.patternProperties[Object.keys(property.patternProperties)[0]].$ref)
    },

    isFolder (property) {
      return this.checkIfObject(property)
          && 'type' in property
          && 'properties' in property
          && property.type === 'object'
    },
  },

  data () {
    return {
      newItemOptions: [
        {
          title: 'Metric',
          icon: 'fa-tag',
          value: 'metric',
          action: () => {
            this.$emit('new', { type: 'metric', parent: this.uuid, index: this.sortedKeys.length })
          },
        },
        {
          title: 'Folder',
          icon: 'fa-folder',
          value: 'folder',
          action: () => {
            this.$emit('new', { type: 'folder', parent: this.uuid, index: this.sortedKeys.length })
          },
        },
        {
          title: 'Sub-Schema',
          icon: 'fa-cube',
          value: 'sub-schema',
          action: () => {
            this.$emit('new', { type: 'sub-schema', parent: this.uuid, index: this.sortedKeys.length })
          },
        },
        {
          title: 'Sub-Schema Array',
          icon: 'fa-cubes',
          value: 'sub-schema-array',
          action: () => {
            this.$emit('new', { type: 'sub-schema-array', parent: this.uuid, index: this.sortedKeys.length })
          },
        },
      ],
    }
  },
}
</script>

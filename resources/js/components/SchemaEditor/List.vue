<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col gap-2 flex-1" :class="guides ? '' : 'overflow-y-auto'">
    <div v-if="guides" class="absolute w-0.5 left-6 top-[3.25rem] bottom-7 bg-gray-300 group-last:h-0"></div>
    <div v-for="(property, name) in properties" class="relative group text-left overflow-visible">
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
      <button class="flex items-center gap-3 border-2 w-full focus:bg-gray-100 hover:bg-gray-50 text-left" v-else-if="isMetric(property)">
        <div v-tooltip="getMetricData(property).types[0]"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-fw text-sm" :class="getMetricData(property).icon"></i>
        </div>
        <div class="flex">
          <div>{{name}}</div>
        </div>
      </button>
      <button @click="goto_url_tab(`schema-editor?schema=${property.$ref.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')}`)" class="flex items-center gap-3 border-2 w-full focus:bg-gray-100 hover:bg-gray-50 text-left" v-else-if="isSchema(property)">
        <div v-tooltip="property.$ref"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-fw text-sm fa-cube"></i>
        </div>
        <div class="flex flex-col">
          <div>{{name}}</div>
          <div class="text-xs text-gray-500 truncate">{{property.$ref.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')}}</div>
        </div>
      </button>
      <button @click="goto_url_tab(`schema-editor?schema=${property.patternProperties[Object.keys(property.patternProperties)[0]].$ref.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')}`)" class="flex items-center gap-3 border-2 w-full focus:bg-gray-100 hover:bg-gray-50 text-left" v-else-if="isSchemaArray(property)">
        <div v-tooltip="`Array of ${property.patternProperties[Object.keys(property.patternProperties)[0]].$ref}`"
             class=" w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
          <i class="fa-solid fa-fw text-sm fa-cubes"></i>
        </div>
        <div class="flex">
          <div class="flex flex-col">
            <div>{{name}}</div>
            <div class="text-xs text-gray-500 truncate">{{property.patternProperties[Object.keys(property.patternProperties)[0]].$ref.replace('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/','')}}</div>
          </div>
        </div>
      </button>
      <div v-else-if="isFolder(property)">
        <div class="flex items-center gap-3 border-2 mb-3">
          <div v-tooltip="'Folder'"
               class="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-gray-200">
            <i class="fa-solid fa-fw text-sm fa-folder"></i>
          </div>
          <div class="flex">
            <div>{{name}}</div>
          </div>
        </div>
        <List class="ml-10" :properties="property.properties"></List>
      </div>
      <div v-else>
        {{property}}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SchemaEditor',

  props: {
    /**
     * The object containing all properties to iterate through
     */
    properties: {
      required: true,
      type: Object,
    },

    /**
    * Whether or not to show the vertical guides for nested items
    */
    guides: {
      required: false,
      type: Boolean,
      default: true
    },
  },

  components: {
    'List': () => import(/* webpackPrefetch: true */ './List.vue'),
  },

  methods: {
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
        icon: `fa-${property.allOf[1].properties.Sparkplug_Type.enum[0][0].toLowerCase()}`,
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
          && Object.keys(property).length === 1
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
          && (new RegExp('-v\\d\.json')).test(property.patternProperties[Object.keys(property.patternProperties)[0]].$ref)
    },

    isFolder(property) {
      return this.checkIfObject(property)
          && 'type' in property
          && 'properties' in property
          && property.type === 'object'
    }
  },

  data () {
    return {}
  },
}
</script>

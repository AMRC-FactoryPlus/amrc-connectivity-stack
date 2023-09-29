<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col px-2 border-l-2 border-gray-100 hover:border-gray-200">

    <!--For every key that isn't a reserved word-->
    <div class="px-1"
         v-for="(key) in Object.keys(schema.properties).filter(e => !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(e))">

      <!--HEADER-->
      <div class="text-xs font-bold mt-2 mb-2 h-5 flex items-center gap-1 justify-between group"
           v-if="type(key)==='object' || type(key)==='schemaArray'">
        <button type="button"
                @click.stop="toggle(key)"
                class="fpl-button-secondary disabled:opacity-50 !text-gray-800 hover:bg-gray-900 hover:bg-opacity-10 flex gap-1 w-full !justify-start">
          <i v-if="isToggled(key)"
             class="fa-sharp fa-solid fa-chevron-down fa-fw text-xs text-gray-400 group-hover:text-gray-900"></i>
          <i v-else class="fa-sharp fa-solid fa-chevron-up fa-fw text-xs"></i>
          <div>
            <div class="font-bold">{{key}}</div>
            <div v-tooltip="'Schema_UUID'"
                 v-if="!isToggled(key) && $root.$data.userPreferences.appearance.preferences.show_uuids.value"
                 class="text-xs font-normal text-gray-400">{{schema.properties[key].properties?.Schema_UUID?.const}}
            </div>
          </div>
          <i v-if="('patternProperties' in schema.properties[key])" v-tooltip="'Array of sub-schemas'"
             class="fa-solid fa-diagram-project text-gray-300 ml-1 group-hover:text-gray-700"></i>
        </button>
        <div class="flex items-center justify-center gap-1">
          <button
              v-tooltip="`Create ${key} entry`"
              @click="newObject(key, schema)"
              class="fpl-button-secondary flex items-center justify-center"
              v-if="'patternProperties' in schema.properties[key]">
            <i class="fa-sharp fa-solid fa-plus mr-1 text-xs"></i>
            <div>Add</div>
          </button>
          <button
              v-tooltip="`Delete ${key}`"
              @click="$emit('deleteObject', [{
                key: key,
              }])"
              class="invisible group-hover:visible fpl-button-secondary flex items-center justify-center hover:text-red-300 hover:bg-transparent"
              v-else-if="canBeDeleted()">
            <i class="fa-sharp fa-solid fa-trash text-xs"></i>
          </button>
        </div>
      </div>

      <!-- ITEM-->
      <button v-show="isToggled(key)" v-if="type(key)==='metric'"
              @click="$emit('selected', [{
                key: key,
                value: schema.properties[key],
                schemaUUID: schema.properties[key].allOf[0]?.properties?.Schema_UUID?.const,
              }])"
              :class="[selectedMetric === schema.properties[key] ? 'bg-brand bg-opacity-5 text-brand border-l-4 border-brand border-opacity-80 -ml-1 ' : 'fpl-button-secondary !justify-start disabled:opacity-50 !text-gray-600 hover:bg-gray-900 hover:bg-opacity-10 flex gap-1']"
              class="ml-2 text-gray-700 text-base flex items-center group w-full py-1 px-3">
        <div>{{key}}</div>
      </button>


      <div v-show="!isToggled(key)" v-if="isEmptyNesting(schema, key)" class="ml-6 flex flex-col p-1 pl-2 mb-1">
        <div class="text-xs text-gray-500 flex items-center gap-1 font-bold">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <div>No Items</div>
        </div>
        <div class="text-xs text-gray-400">Add an entry with the button above</div>
      </div>

      <!-- NESTED ITEMS -->
      <SchemaGroup
          @selected="e => $emit('selected', [...e, ...[{key: key, schemaUUID: schema.properties[key].properties?.Schema_UUID?.const}]])"
          @newObject="e => $emit('newObject', [...e, ...[{key: key}]])"
          @deleteObject="e => $emit('deleteObject', [...e, ...[{key: key}]])"
          @addToMetricArray="$emit('addToMetricArray')"
          v-show="!isToggled(key)"
          v-if="type(key)==='object'"
          :selected-metric="selectedMetric"
          :schema="schema.properties[key]"
          :nested-path="[...nestedPath, ...[key]]"
          :model="model"></SchemaGroup>

    </div>
  </div>
</template>

<script>
export default {
  name: 'SchemaGroup',

  components: {},

  mounted () {
    if (localStorage.getItem(`toggleState-${this.model.Instance_UUID}`)) {
      try {
        this.toggleState = JSON.parse(localStorage.getItem(`toggleState-${this.model.Instance_UUID}`))
      } catch (e) {
        localStorage.removeItem(`toggleState-${this.model.Instance_UUID}`)
      }
    }
  },

  props: {
    nestedPath: {
      required: false,
      type: Array,
      default: () => [],
    },
    schema: {
      required: true,
      type: Object,
    },
    selectedMetric: {},
    model: {
      required: true,
      type: Object,
    },
  },

  methods: {

    newObject (key, schema) {
      this.$emit('newObject', [
        {
          key: key,
          value: schema.properties[key],
        }])
      this.toggle(key, true)
    },

    isEmptyNesting (schema, key) {
      return Object.keys(schema.properties[key]).length === 2 && Object.keys(schema.properties[key]).includes('type') &&
          Object.keys(schema.properties[key]).includes('patternProperties')
    },

    canBeDeleted () {

      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.
      let n = this.nestedPath.slice(0, -1).flatMap(e => ['properties', e])

      // Work out what the object looks like for this model in the schema
      let nestedProperty = n.reduce((object, key) => object?.[key], this.schema)

      // If the nestedProperty has a patternProperties then we are a dynamic object and can be deleted
      if (nestedProperty?.patternProperties) {
        return true
      }
    },

    type (key) {

      if ('properties' in this.schema.properties[key]) {
        return 'object'
      }

      if ('allOf' in this.schema.properties[key]) {
        return 'metric'
      }

      if ('patternProperties' in this.schema.properties[key]) {
        return 'schemaArray'
      }

      return 'unknown'
    },

    getTogglePath (obj) {
      return `${this.nestedPath.length > 0 ? (this.nestedPath.join('.') + '.') : ''}${obj}`
    },

    toggle (obj, state = null) {

      if (state === true) {
        if (!this.toggleState.includes(this.getTogglePath(obj))) {
          this.toggleState.push(this.getTogglePath(obj))
        }
      } else if (state === false) {
        if (this.toggleState.includes(this.getTogglePath(obj))) {
          this.toggleState.splice(this.toggleState.indexOf(this.getTogglePath(obj)), 1)
        }
      } else {
        if (!this.toggleState.includes(this.getTogglePath(obj))) {
          this.toggleState.push(this.getTogglePath(obj))
        } else {
          this.toggleState.splice(this.toggleState.indexOf(this.getTogglePath(obj)), 1)
        }
      }
      this.saveToggleState()
    },

    saveToggleState () {
      const parsed = JSON.stringify(this.toggleState)
      localStorage.setItem(`toggleState-${this.model.Instance_UUID}`, parsed)
    },

    isToggled (obj) {
      return !this.toggleState.includes(this.getTogglePath(obj))
    },

  },
  data () {
    return {
      toggleState: [],
    }
  },
}
</script>

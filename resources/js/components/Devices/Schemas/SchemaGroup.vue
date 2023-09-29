<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col px-2 border-l-2 border-gray-100 hover:border-gray-200">
    <overlay :show="newObjectDialogVisible" @close="newObjectDialogVisible = false" title="New Object">
      <template #content>
        <NewObjectOverlayForm @create="createObject" v-model="newObjectName"
                              :regex="regexValidation"></NewObjectOverlayForm>
      </template>
    </overlay>

    <!--For every key that isn't a reserved word-->
    <div class="px-1"
         v-for="object in Object.keys(metrics).filter(e => !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(e))">
      <!--HEADER-->
      <div class="text-gray-600 text-xs font-bold mt-2 mb-2 flex items-center gap-2" v-if="!('metric' in metrics[object]) && !('items' in
      metrics[object])">
        <button type="button"
                @click.stop="toggle(object)"
                class="fpl-button-secondary w-3 h-5 disabled:opacity-50 hover:!text-gray-700">
          <i v-if="isToggled(object)" class="fa-sharp fa-solid fa-plus fa-fw text-xs"></i>
          <i v-else class="fa-sharp fa-solid fa-minus fa-fw text-xs"></i>
        </button>
        <div>
          <div>{{ object }}</div>
          <div v-tooltip="'Schema_UUID'" v-if="!isToggled(object) && $root.$data.userPreferences.appearance.preferences.show_uuids.value" class="text-xs font-normal text-gray-400">{{ metrics[object].$meta.Schema_UUID }}</div>
        </div>
        <i v-if="('patternProperties' in metrics[object])" v-tooltip="'Array of sub-schemas'"
           class="fa-solid fa-diagram-project text-gray-300"></i>
      </div>

      <!-- IF ARRAY OF METRICS -->
      <div v-show="!isToggled(object)" class="text-gray-500/70 flex items-center group w-full py-1 px-3 gap-2" v-if="('items' in
      metrics[object])">
        <div>{{ object }}</div>
        <i v-tooltip="'Array of metrics'" class="text-xs fa-solid fa-layer-group text-gray-300"></i>
      </div>
      <button @click="addNewMetricToArray(metrics[object])"
              class="fpl-button-info flex items-center justify-center ml-4" v-if="('items' in metrics[object] && 'metric' in
              metrics[object].items)">
        <i class="fa-sharp fa-solid fa-plus mr-1 text-xs"></i>
        <div>Add</div>
      </button>

      <!-- IF ARRAY OF SCHEMAS -->
      <button
          v-show="!isToggled(object)"
          @click="showNewObjectNameDialog(metrics[object], Object.keys(metrics[object].patternProperties).filter(e => e !== '$meta')[0])"
          class="fpl-button-info flex items-center justify-center" v-if="('patternProperties' in metrics[object])">
        <i class="fa-sharp fa-solid fa-plus mr-1 text-xs"></i>
        <div>Add</div>
      </button>

      <!--ITEM-->
      <button v-show="!isToggled(object)" v-if="model && ('metric' in metrics[object])"
              @click="$emit('selected', metrics[object])"
              :class="[selectedMetric === metrics[object] ? 'bg-brand bg-opacity-5 text-brand border-l-4 border-brand border-opacity-80 -ml-1 ' : 'text-opacity-70 hover:text-opacity-100 hover:bg-brand hover:bg-opacity-5']"
              class="text-gray-600 text-base flex items-center group w-full py-1 px-3">
        <i v-if="configured(metrics[object])" v-tooltip="'Configured'"
           class="hidden fa-sharp fa-solid fa-question fa-fw mr-2 text-xs"></i>
        <div>{{ object }}</div>
        <!--   ! If required     -->
      </button>

      <!-- NESTED ITEMS -->
      <SchemaGroup @selected="$emit('selected', $event)" @add="createObject" @addToMetricArray="addNewMetricToArray"
                   v-show="!isToggled(object)"
                   v-if="model && !('metric' in
      metrics[object]) && !('items' in
      metrics[object])" :metrics="metrics[object]" :selected-metric="selectedMetric" :model="model"></SchemaGroup>


    </div>
  </div>
</template>

<script>
export default {
  name: 'SchemaGroup',

  components: {
    'overlay': () => import(/* webpackPrefetch: true */ '../../General/Overlay.vue'),
    'NewObjectOverlayForm': () => import(/* webpackPrefetch: true */ './NewObjectOverlayForm.vue'),
  },

  props: {
    metrics: {
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

    toggle(obj) {
      if (!this.toggled.includes(obj)) {
        this.toggled.push(obj);
      } else {
        this.toggled.splice(this.toggled.indexOf(obj), 1);
      }
    },

    isToggled(obj) {
      return this.toggled.includes(obj);
    },

    showNewObjectNameDialog(val, regex) {
      this.regexValidation = regex;
      this.newObjectSchemaLocation = val.patternProperties[regex].$meta.keyPath;
      this.newObjectReferenceLocation = val.patternProperties[regex].$meta.namePath;
      this.newObjectDialogVisible = true;
    },

    addNewMetricToArray(val) {
      this.$emit('addToMetricArray', val);
    },

    createObject(obj = null) {
      // This takes an optional obj parameter to allow nested versions to bubble up
      if (obj) {
        this.$emit('add', obj);
      } else {
        this.$emit('add', {
          location: this.newObjectSchemaLocation,
          name: this.newObjectName,
          reference: this.newObjectReferenceLocation
        });
      }
    },

    configured(val) {
      if (!val.namePath) {
        return;
      }
      return this.get(val.namePath.join('/'), this.model, '/');
    },

    get(path, onObject, delimiter = '.') {
      let schema = onObject;  // a moving reference to internal objects within obj
      const pList = path.split(delimiter);
      const len = pList.length;
      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i];
        if (!schema[elem]) schema[elem] = {};
        schema = schema[elem];
      }
      return schema[pList[len - 1]];
    },
  },
  data() {
    return {
      newObjectDialogVisible: false,
      newObjectSchemaLocation: null,
      newObjectReferenceLocation: null,
      newObjectName: '',
      regexValidation: '.+',
      toggled: [],
    };
  },
};
</script>
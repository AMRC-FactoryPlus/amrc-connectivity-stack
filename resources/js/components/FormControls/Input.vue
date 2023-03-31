<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="grid grid-cols-3 gap-10 flex-grow">
    <div v-if="showDescription" class="col-span-1 text-sm text-gray-400 my-auto mt-7">
      {{ control.description }}
    </div>
    <div class="flex flex-col" :class="[showDescription ? 'col-span-2' : 'col-span-3']">
      <div class="flex items-center mb-1">
        <h4 v-if="control.name">{{ control.name }}</h4>
        <button v-if="control.infoLink" @mouseup="goto_url_tab(control.infoLink)"
                v-tooltip="control.infoTooltip" class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></button>
        <i v-else-if="control.infoTooltip"
           v-tooltip="control.infoTooltip" class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></i>
      </div>
      <div class="flex w-full relative">
        <input v-if="control.prefix" disabled v-model="control.prefix" class="fpl-input w-24 text-gray-700 text-right">
        <input v-on:keyup.enter="$emit('keyUpEnter')" :disabled="control.disabled" :type="password ? 'password' : 'text'"
               v-model="localValue"
               :placeholder="control.placeholder"
               class="fpl-input flex-grow text-gray-700"
               :class="(valid.$invalid) ? 'ring-2 ring-offset-2 ring-opacity-30 ring-red-500' :''">
        <div class="absolute right-0 top-0 bottom-0 flex items-center justify-center pr-3">
          <div v-tooltip="valid.$silentErrors?.length > 0 ? (valid.$silentErrors[0].$message) : null"
               class="mr-auto px-2 py-1 bg-red-200 text-red-500 text-xs cursor-default"
               v-if="valid.$invalid">INVALID
          </div>
          <slot name="info"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Input',
  props: {
    control: {},
    valid: {},
    value: {},
    showDescription: {
      type: Boolean,
      default: true,
    },
    password: {
      required: false,
      type: Boolean,
      default: false,
    },
  },

  watch: {
    value(val) {
      this.localValue = val;
    },
    localValue(val) {
      this.$emit('valueUpdated', val);
      this.$emit('input', val);
    },
  },

  data() {
    return {
      localValue: this.value,
    };
  },
};
</script>
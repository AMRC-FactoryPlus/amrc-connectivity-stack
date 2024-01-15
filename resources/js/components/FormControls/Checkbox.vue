<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div @mouseup="toggle"
       class="cursor-pointer flex justify-between items-center w-full select-none text-gray-500 focus:ring-gray-400 p-4 gap-3"
       :class="[
             localValue ? 'bg-gray-100' : 'hover:bg-gray-100']">
    <div
        class="w-5 h-5 flex items-center justify-center border focus:outline-none text-center text-xs mx-10 lg:mx-0 flex-shrink-0"
        :class="[localValue ? 'bg-gray-700 text-white' : 'bg-white']">
      <input type="checkbox" class="hidden" checked>
      <i class="fa-solid fa-check" :class="this.localValue ? '' : 'hidden'"></i>
    </div>
    <div v-if="control.name" class="flex flex-col flex-shrink">
      <div class="bg-transparent text-gray-700 flex focus:outline-none text-left"
           :class="[control.description ? 'mb-1' : 'text-sm']">{{
          control.name
        }}
      </div>
      <div class="text-xs text-gray-500" v-if="control.description">{{control.description}}</div>
    </div>
  </div>
</template>
<script>
export default {
  name: 'Checkbox',
  props: {
    control: {},
    valid: {},
    value: {},
  },

  watch: {

    value (val) {
      this.localValue = val
    },

    localValue (val) {
      this.$emit('valueUpdated', val)
      this.$emit('input', val)
    },
  },

  methods: {
    toggle () {
      this.localValue = !this.localValue
    },

    reset () {
      this.localValue = this.control.default ? this.control.default : false
    },
  },

  data () {
    return {
      localValue: !!this.value,
    }
  },
}
</script>

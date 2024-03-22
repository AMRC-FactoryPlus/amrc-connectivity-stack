<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col">
    <div v-if="control.options?.length === 0">
      <div class=" bg-gray-100 animate-pulse flex relative items-center justify-start w-full h-16"></div>
    </div>
    <button :disabled="option.disabled" @mouseup="optionSelected(option)" v-for="option in control.options"
            class="group fpl-button-secondary flex relative items-center justify-start mb-3 !p-6">
      <div v-if="'icon' in option" class="fa-fw mr-6 text-lg"
           :class="option.icon"></div>
      <div class="flex-grow flex flex-col justify-start col-span-3">
        <div class="flex items-end">
          <div class="text-sm text-gray-700 font-semibold capitalize">{{ option.title }}</div>
        </div>
        <div class="text-xs text-gray-500 mr-auto text-left">{{ option.description }}</div>
      </div>
    </button>
  </div>
</template>
<script>
export default {
  name: 'Selection',
  props: {
    control: {},
    value: {},
    col: {
      required: false,
      type: Boolean,
      default: true,
    },
  },

  watch: {
    localValue (val) {
      this.$emit('valueUpdated', val);
    },
  },

  methods: {
    optionSelected (option) {

      this.$emit('valueUpdated', 'value' in option ? option.value : option);
      this.$emit('navigate', 'nextStep');
    },
  },

  data () {
    return {
      localValue: this.value,
    };
  },
};
</script>

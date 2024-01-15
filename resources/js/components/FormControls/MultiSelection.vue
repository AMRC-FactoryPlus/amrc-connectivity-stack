<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-wrap gap-3">
    <div v-if="control.options?.length === 0">
      <div class=" bg-gray-100 animate-pulse flex relative items-center justify-start w-full h-16"></div>
    </div>
    <div v-for="option in control.options" class="mb-3">
      <form-control-checkbox :key="control.id" :control="{name: option.title, description: option.description}" :valid="true"
                             @valueUpdated="updateCheckState(option)"/>
    </div>
  </div>
</template>
<script>
export default {
  name: 'MultiSelection',
  props: {
    control: {},
    value: {},
  },

  components: {
    'form-control-checkbox': () => import(/* webpackPrefetch: true */ '../FormControls/Checkbox.vue'),
  },

  watch: {
    localValue (val) {
      this.$emit('valueUpdated', val);
    },
  },

  methods: {
    updateCheckState (option) {
      if (this.localValue.includes(option.value)) {
        this.localValue.splice(this.localValue.indexOf(option.value), 1);
        return;
      }
      this.localValue.push(option.value);
    },
  },

  data () {
    return {
      localValue: this.value,
    };
  },
};
</script>

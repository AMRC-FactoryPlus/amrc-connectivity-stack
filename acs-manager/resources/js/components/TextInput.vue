<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <TextField @keyUpEnter="$emit('keyUpEnter')" :title="title" :icon="icon" v-model="localValue" :placeholder="placeholder"
         :valid="valid"></TextField>
</template>
<script>
    export default {
      name: 'TextInput',
      props: {
        title: {},
        placeholder: {},
        valid: {},
        value: {},
        icon: {},
      },

      watch: {

        value(val) {
          this.localValue = val;
        },

        localValue (val) {
          this.$emit('input', val);
          this.$emit('valueUpdated', val); // Kept for legacy
        },
      },

      data () {
        return {
          localValue: this.value,
        };
      },
    }
</script>

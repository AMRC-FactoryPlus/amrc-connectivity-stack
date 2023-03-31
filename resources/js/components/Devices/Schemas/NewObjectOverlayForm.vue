<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col">
    <Input
        @keyUpEnter="$emit('create')"
        class="!mb-3"
        :showDescription="false"
        :control="{
                name: 'Name',
              }"
        :valid="v"
        v-model="v.localValue.$model"></Input>
    <button :disabled="(v && v.$invalid)" @click="$emit('create')" class="fpl-button-brand h-10 px-10 ml-auto">
      Create Object
      <i class="fa-sharp fa-solid fa-plus ml-2"></i>
    </button>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core';
import { required, minLength, helpers } from '@vuelidate/validators';

export default {
  setup () {
    return { v: useVuelidate() };
  },

  name: 'NewObjectOverlayForm',

  props: {
    value: { required: true },
    regex: { required: true },
  },

  watch: {
    localValue (val) {
      this.$emit('input', val);
    },
  },

  data () {
    return {
      localValue: this.value,
      regexValidation: '.+',
    };
  },

  validations () {
    return {
      localValue: {
        required,
        minLength: minLength(1),
        opcEndpoint: helpers.withMessage('Invalid name.', helpers.regex(new RegExp(this.regex))),
      },
    };
  },
};
</script>


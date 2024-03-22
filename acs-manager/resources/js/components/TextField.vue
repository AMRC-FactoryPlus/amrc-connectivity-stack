<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div>
    <div class="grid grid-cols-3 gap-10 flex-grow">
      <div class="flex flex-col col-span-3">
        <div class="flex items-center mb-1">
          <h4 v-if="title">{{ title }}</h4>
          <i v-if="info" v-tooltip="info" class="text-primary-lightest fa-sharp fa-solid fa-info-circle"></i>
        </div>
        <div class="relative w-full flex-1 flex items-center group">
          <div v-if="!icon || (icon && iconPosition !== 'none')" class="flex items-center justify-center pl-3 absolute left-0 pointer-events-none">
            <i :class="['fa-'+icon]" class="pointer-events-none fa-solid fa-fw text-gray-300 text-sm"></i>
          </div>
          <input
              ref="input"
              @keyup.esc="clear"
              @keyup.enter="$emit('keyUpEnter')"
              @input="$emit('input')"
              :placeholder="placeholder"
              :disabled="disabled"
              :type="type"
              :class="[layout, invalidStyle]"
              v-model="content"/>
          <div class="absolute right-0 top-0 bottom-0 flex items-center justify-center pr-3">
            <div v-tooltip="valid.$silentErrors.length > 0 ? (valid.$silentErrors[0].$message) : null" class="mr-auto px-2 py-1 bg-red-200 text-red-500 text-xs cursor-default"
                 v-if="isInvalid">INVALID
            </div>
            <slot name="info"></slot>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TextField',
  props: {
    value: {},

    /**
     * The type of the input
     */
    type: {
      required: false,
      type: String,
      default: 'text',
    },

    /**
     * The text to display above the field as a title
     */
    title: {
      required: false,
      type: String,
    },

    /**
     * The placeholder text to display in the field when empty
     */
    placeholder: {
      required: false,
      type: String,
    },

    /**
     * The icon to display
     */
    icon: {
      required: false,
      type: String,
    },

    /**
     * Where the icon should be placed
     */
    iconPosition: {
      required: false,
      type: String,
      validator: (val) => [
        'none',
        'left',
      ].includes(val),
      default: 'left',
    },

    /**
     * The text to show as a tooltip in an information icon to the right of the input
     */
    info: {
      required: false,
      type: String,
    },

    /**
     * Whether or not to show the clear button on the right side of the input
     */
    showClear: {
      type: Boolean,
      default: true,
    },

    /**
     * The Vuelidate validation object for this field to determine whether or not the input is valid
     */
    valid: {
      type: Object,
    },

    /**
     * Whether or not the action behind the input is processing
     */
    loading: {
      required: false,
      type: Boolean,
    },

    /**
     * Whether or not the text field is disabled
     */
    disabled: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * The text to display via a tooltip when the input is disabled
     */
    disabledText: {
      required: false,
      type: String,
    },

    /**
     * Whether or not to show a border on the input
     */
    border: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * A regex expression to mask the input as users type
     */
    mask: {
      required: false,
      type: RegExp,
    },

    /**
    * Whether or not to hide inline validation errors
    */
    hideErrors: {
      required: false,
      type: Boolean,
      default: false
    },

    /**
    * Whether or not to debounce the output
    */
    applyDebounce: {
      required: false,
      type: Boolean
    },

    /**
    * Whether or not to run action once before debouncing or to only run after all debounce activity has calmed
    */
    debounceLeading: {
      required: false,
      type: Boolean,
      default: true
    },
  },

  watch: {
    content (val) {
      // If we don't have a mask then simply pass through
      if (!this.mask) {
        this.$emit('input', val);
        return;
      }

      if (this.mask.test(val)) {
        // If the new value matches mask then allow it
        this.lastGoodValue = val;
        this.$emit('input', val);
      } else {
        // Otherwise set it back to the old value and emit that instead
        this.content = this.lastGoodValue;
        this.$emit('input', this.lastGoodValue);
      }
    },

    value (val) {
      if (this.applyDebounce && this.debounceLeading) {
        this.debounce(() => {this.content = val;}, true);
      } else if (this.applyDebounce && !this.debounceLeading) {
        this.debounce(() => {this.content = val;}, false);
      } else {
        this.content = val;
      }
    },
  },

  computed: {
    layout () {
      return [
        'fpl-input flex-grow text-gray-700',
        (this.icon && this.iconPosition !== 'none') ? '!pl-10' : '',
      ];
    },

    invalidStyle () {
      return this.isInvalid ? 'ring-2 ring-offset-2 ring-opacity-30 ring-red-500' : '';
    },

    isInvalid () {
      if (this.hideErrors) {
        return false;
      }
      return this.valid && this.valid.$dirty && this.valid.$invalid === true;
    },

    errorMessage () {
      if (this.valid && this.valid.$silentErrors && this.valid.$silentErrors.length > 0) {
        return this.valid.$silentErrors[0].$message;
      }
      return false;
    },
  },

  mounted () {
    this.$emit('mounted');
  },

  methods: {
    clear () {
      this.content = '';
      this.$emit('keyUpEsc');
    },
  },

  data () {
    return {
      content: this.value,
      lastGoodValue: '',
    };
  },
};
</script>

<style scoped>

</style>
<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex">
    <button
        :disabled="disabled || loading"
        class="disabled:opacity-30 disabled:cursor-not-allowed w-full justify-center h-10 inline-flex items-center px-4 py-2 bg-gray-800 border border-transparent text-xs text-white uppercase tracking-widest hover:bg-gray-700 active:bg-gray-900 focus:outline-none focus:border-gray-900 focus:shadow-outline-gray transition ease-in-out duration-150 mb-4"
        @keydown.enter="$emit('click'); $emit('mouseup')"
        @mousedown="(loading || disabled) ? () => {} : $emit('mousedown')"
        @mouseenter="(loading || disabled) ? () => {} : $emit('mouseenter')"
        @mouseleave="(loading || disabled) ? () => {} : $emit('mouseleave', $event)"
        @mousemove="(loading || disabled) ? () => {} : $emit('mousemove', $event)"
        @mouseout="(loading || disabled) ? () => {} : $emit('mouseout', $event)"
        @mouseover="(loading || disabled) ? () => {} : $emit('mouseover', $event)"
        @mouseup="(loading || disabled) ? () => {} : $emit('mouseup', $event)"
    >
      <slot v-if="$scopedSlots.default"></slot>
      <div class="flex items-center justify-center" v-else>
        <div v-if="loading" class="flex items-center justify-center">
          <i class="fa-solid fa-circle-notch fa-spin fa-fw text-base"></i>
        </div>
        <div v-else class="flex items-center justify-center gap-2" :class="(iconPosition === 'right') ? 'flex-row-reverse' : 'flex-row'">
          <i v-if="icon" class="fa-solid" :class="'fa-'+icon"></i>
          <i v-if="secondIcon" class="fa-solid" :class="'fa-'+secondIcon"></i>
          <div v-if="text && iconPosition !== 'only'" class="whitespace-nowrap">{{ text }}</div>
        </div>
      </div>
    </button>
  </div>
</template>

<script>
export default {
  name: 'Button',
  props: {

    /**
     * The style of button
     */
    type: {
      required: true,
      type: String,
      validator: (val) => [
        'primary',
      ].includes(val),
    },

    /**
     * Whether or not the icon should be a small icon
     */
    small: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * Where the icon should be placed
     */
    iconPosition: {
      required: false,
      type: String,
      validator: (val) => [
        'left',
        'right',
        'only',
      ].includes(val),
      default: 'left',
    },

    /**
     * Whether or not to show a fixed-width button
     */
    fixedWidth: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * Whether or not to show the focus ring
     */
    noFocus: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * The optional text to display on the button
     */
    text: {
      required: false,
      type: String,
    },

    /**
     * The optional icon name (e.g. check, trash) to display on the button
     */
    icon: {
      required: false,
      type: String,
    },

    /**
     * The optional second icon name (e.g. check, trash) to display on the button
     */
    secondIcon: {
      required: false,
      type: String,
    },

    /**
     * Whether or not the button is loading/being submitted
     */
    loading: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * Whether the button should be disabled
     */
    disabled: {
      type: Boolean,
      default: false,
    },

    /**
     * Whether or not this button is the start of a button group
     */
    groupStart: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * Whether or not this button is the middle of a button group
     */
    groupMiddle: {
      required: false,
      type: Boolean,
      default: false,
    },

    /**
     * Whether or not this button is the end of a button group
     */
    groupEnd: {
      required: false,
      type: Boolean,
      default: false,
    },
  },
};
</script>
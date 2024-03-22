<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div v-if="options.filter(e => ((('show' in e) && typeof e.show === 'function' && e.show(row)) || !('show' in e))).length > 0" class="relative">
    <div ref="dropdown-button" @click.stop="toggleDropdown">
      <slot v-if="$scopedSlots.default"></slot>
      <Button
          v-else
          type="secondary"
          icon="ellipsis-h"
          icon-position="only"
      />
    </div>
    <div @mouseup="dropdownVisible = false" v-if="dropdownVisible"
         class="fixed inset-0 z-10 bg-primary-jet bg-opacity-80"></div>
    <div v-if="dropdownVisible" class="z-50">
      <OverflowMenuContent :is-parent="true" @close="toggleDropdown" @selected="propagateSelected" class="top-6" :options="options" :additionalClasses="additionalClasses"
                           :row="row"></OverflowMenuContent>
    </div>
  </div>
  <div v-else class="flex items-center justify-center gap-2 text-sm animate-pulse text-gray-400">
    <i class="fa-solid fa-circle-notch animate-spin"></i>
    <div>Loading Options (or no options)...</div>
  </div>
</template>

<script>
export default {

  name: 'OverflowMenu',

  components: {
    'OverflowMenuContent': () => import(/* webpackPrefetch: true */ './OverflowMenuContent.vue'),
  },

  props: {
    /**
     * An array of options for the dropdown to display.
     */
    options: { type: Array },

    /**
     * Any additional classes to add to the dropdown container.
     */
    additionalClasses: { type: String, default: '' },

    /**
     * The parent row where the dropdown is situated.
     */
    row: { default: null },
  },

  watch: {
    dropdownVisible (val) {
      if (val === false) {
        this.$emit('close');
      }
    },
  },

  mounted () {
    window.events.$on('hide-dropdown', () => {this.dropdownVisible = false;});
  },

  methods: {

    propagateSelected (val) {
      this.$emit('selected', val);
    },

    toggleDropdown () {
      this.dropdownVisible = !this.dropdownVisible;
      window.events.$emit('action-dropdown-toggled');
    },
  },

  data () {
    return {
      dropdownVisible: false,
      activeHover: null,
    };
  },
};
</script>

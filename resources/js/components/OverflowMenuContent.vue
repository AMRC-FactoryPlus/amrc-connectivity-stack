<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="z-50 w-full" :class="{'absolute': isParent}">
    <div ref="dropdown" class="bg-white dark:bg-primary-darkest shadow-lg whitespace-nowrap p-2 transition-all fixed"
         :class="[isBreachingBottom ? '!bottom-0' : '', isBreachingTop ? '!top-0' : '', isBreachingLeft ? 'left-0' : '', isBreachingRight ? 'right-0' : '']"
         :style="'translate: -'+translateDropdownByPixels+'px;'">
      <div class="flex flex-col overflow-auto">
        <div @mouseover="hoverOption(option, $event)" @mouseup="selectOption(option, $event)" v-for="option in options"
             v-if="('show' in option) && option.show(row) || !('show' in option)"
             class="cursor-pointer flex items-center hover:bg-gray-100 flex justify-between px-4 py-3">
          <div class="text-gray-500 h-6 flex items-center justify-center flex-1">
            <div v-if="('options' in option && localShowOnLeft)" class="relative h-12">
              <OverflowMenuContent @close="$emit('close')"
                                   :show-on-left="localShowOnLeft" class="mr-8 !mt-0"
                                   v-if="hoveredOption && hoveredOption === option && 'options' in hoveredOption"
                                   :options="hoveredOption.options" :additionalClasses="additionalClasses"
                                   :row="row"></OverflowMenuContent>
            </div>
            <div v-if="'icon' in option" class="fa mr-5 w-4 text-center" :class="[option.class ? option.class : 'text-gray-500', option.icon]"
                 :style="'color: #' + option.iconColour"></div>
            <div v-if="'indicator' in option" class="w-2 h-2 rounded-full mr-5" :style="'background-color: #' + option.indicator"></div>
            <div class="flex-grow truncate" :class="option.class ? option.class : ''">{{ option.title }}</div>
            <div v-if="('options' in option)" class="text-primary-lighter ml-3 w-6 text-center fa-solid"
                 :class="[localShowOnLeft === false ? 'fa-angle-right' : 'fa-angle-left']"></div>
            <div v-if="('options' in option && localShowOnLeft === false)" class="relative h-12">
              <OverflowMenuContent @close="$emit('close')" @selected="propagateSelected"
                                   class="ml-8 !mt-0" v-if="hoveredOption && hoveredOption === option && 'options' in hoveredOption"
                                   :options="hoveredOption.options" :additionalClasses="additionalClasses"
                                   :row="row"></OverflowMenuContent>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OverflowMenuContent',

  components: {
    'OverflowMenuContent': () => import(/* webpackPrefetch: true */ './OverflowMenuContent.vue'),
  },

  computed: {

    viewportWidth () {
      return window.innerWidth;
    },
  },

  props: {
    /**
     * Whether or not this is the top of the chain
     */
    isParent: {
      required: false,
      type: Boolean,
      default: true,
    },

    /**
     * The width of the parent button so that we can align right edges if we're cascading left
     */
    parentButtonWidth: {
      required: false,
      type: Number,
    },

    /**
     * An array of options to display in the dropdown
     */
    options: {
      required: true,
      type: Array,
    },

    /**
     * Any additional classes to add to the dropdown container.
     */
    additionalClasses: { type: String, default: '' },

    /**
     * The parent row where the dropdown is situated.
     */
    row: { default: null },

    /**
     * Whether or not to show the dropdown on the left
     */
    showOnLeft: {
      required: false,
      type: Boolean,
    },
  },

  created () {
    window.addEventListener('resize', this.updateElementSize);
  },
  destroyed () {
    window.removeEventListener('resize', this.updateElementSize);
  },

  mounted () {
    this.updateElementSize();
    if (this.showOnLeft) {
      this.localShowOnLeft = this.showOnLeft;
    } else {
      this.localShowOnLeft = this.$el.getBoundingClientRect().right >= this.viewportWidth;
    }

  },

  methods: {

    propagateSelected (val) {
      this.$emit('selected', val);
    },

    updateElementSize () {
        let el = this.$refs['dropdown'].getBoundingClientRect();
        this.spaceLeft = el.left;
        this.spaceRight = window.innerWidth - el.right;
        this.width = el.width;

        // This calculates how much to shift the dropdown by so that the right edges align when cascading right
        if (this.spaceRight <= this.spaceLeft) {
          this.translateDropdownByPixels = el.width - this.parentButtonWidth;
        } else {
          this.translateDropdownByPixels = 0;
        }

        // Calculate if we're breaching the bottom
        this.isBreachingBottom = el.bottom > window.innerHeight;
        this.isBreachingTop = el.top < 0;
        this.isBreachingRight = el.right > window.innerWidth;
        this.isBreachingLeft = el.left < 0;
    },

    selectOption (option, event) {
      this.$emit('close');
      if ('options' in option) {
        this.hoverOption(option);
        return;
      }
      this.dropdownVisible = false;
      this.propagateSelected(option.action(this.row, event));
    },

    hoverOption (option) {
      if ('options' in option) {
        this.hoveredOption = option;
      } else {
        this.hoveredOption = null;
      }
    },
  },

  data () {
    return {
      isBreachingTop: false,
      isBreachingBottom: false,
      isBreachingRight: false,
      isBreachingLeft: false,
      hoveredOption: null,
      localShowOnLeft: false,
      translateDropdownByPixels: 0,
    };
  },
};
</script>

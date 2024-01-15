<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <!-- This example requires Tailwind CSS v2.0+ -->
  <div class="relative inline-block text-left mr-auto flex-1">
    <div>
      <div v-if="!hideTitle" class="flex items-center mb-1">
        <h4 v-if="control.name">{{control.name}}</h4>
        <button v-if="control.infoLink" @mouseup="goto_url_tab(control.infoLink)"
                v-tooltip="control.infoTooltip"
                class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></button>
        <i v-else-if="control.infoTooltip"
           v-tooltip="control.infoTooltip" class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></i>
      </div>
      <button @click="toggleDropdown" type="button"
              class="inline-flex justify-center w-full  border border-gray-200 pl-4 py-2 bg-white font-medium text-gray-700 hover:bg-gray-50 fpl-input"
              :class="[(valid?.$invalid) ? 'ring-2 ring-offset-2 ring-opacity-30 ring-red-500' :'']"
              id="menu-button" aria-expanded="true" aria-haspopup="true">
        <span class="flex-grow text-left">
          {{displayVal}}
        </span>
        <i class="fa-solid fa-chevron-down text-gray-400"></i>
        <div class="flex items-center justify-center ml-5" v-if="valid?.$invalid">
          <div v-tooltip="valid.$silentErrors.length > 0 ? (valid.$silentErrors[0].$message) : null"
               class="mr-auto px-2 py-1  bg-red-200 text-red-500 text-xs cursor-default">INVALID
          </div>
          <slot name="info"></slot>
        </div>
      </button>
    </div>
    <div v-if="showDropdown" @click="showDropdown=false"
         class="fixed z-50 left-0 right-0 top-0 bottom-0 bg-gray-700 opacity-10 z-40"></div>

    <Transition
        enter-class="transform opacity-0 scale-95"
        enter-active-class="transition ease-out duration-100"
        enter-to-class="transform opacity-100 scale-100"
        leave-class="transform opacity-100 scale-100"
        leave-active-class="transition ease-in duration-75"
        leave-to-class="transform opacity-0 scale-95">
      <div v-if="showDropdown"
           class="origin-top-right absolute left-0 mt-2 w-56  shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50 overflow-y-auto max-h-64"
           role="menu" aria-orientation="vertical" aria-labelledby="menu-button" tabindex="-1">
        <div class="py-1" role="none">
          <!-- Active: "bg-gray-100 text-gray-900", Not Active: "text-gray-700" -->
          <button @mouseup="optionSelected(option)" v-for="option in control.options"
                  class="block text-sm hover:bg-gray-50 w-full text-left" role="menuitem"
                  tabindex="-1"
                  id="menu-item-0">
            <Checkbox
                v-if="multi"
                :value="value.includes(option.value)"
                :valid="{}"
                :control="{name: option.title,}"/>
            <div class="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-50 w-full text-left" v-else>{{option.title}}</div>
          </button>
        </div>
      </div>
    </Transition>

  </div>
</template>
<script>
export default {
  name: 'Dropdown',
  props: {
    control: {},
    value: {},
    valid: {},
    /**
     * Whether or not to hide the title
     */
    hideTitle: {
      required: false,
      type: Boolean,
    },

    /**
     * Whether multiple options can be selected
     */
    multi: {
      required: false,
      type: Boolean,
    },

    /**
     * Whether or not to automatically select the first option
     */
    selectFirst: {
      required: false,
      type: Boolean,
      default: false,
    },
  },

  components: {
    'Checkbox': () => import(/* webpackPrefetch: true */ '../FormControls/Checkbox.vue'),
  },

  watch: {
    // ? How is the Value changing? We're not publishing it from localValue here.
    value: {
      handler(val) {
        this.localValue = [...[], ...val]
        if (this.multi) {
          this.displayVal = this.localValue.map(v => this.control.options.find(o => o.value === v).title).join(', ')
        } else {
          this.displayVal = this.control.options.find(o => o.value === val).title
        }
      },
      immediate: true,
    },

    'control.options': function (val) {
      if (this.selectFirst) {
        this.optionSelected(this.control.options[0])
      }
    },
  },

  mounted () {
    if (this.selectFirst && this.control.options.length > 0) {
      this.optionSelected(this.control.options[0])
    }
  },

  methods: {
    toggleDropdown () {
      this.showDropdown = !this.showDropdown
    },

    optionSelected (option) {

      if (this.multi) {

        // If the value isn't an array, make it one
        if (Array.isArray(this.localValue) === false) {
          this.localValue = []
        }

        // If the value is already in the array, remove it, otherwise add it
        if (this.localValue.includes(option.value)) {
          this.localValue.splice(this.value.indexOf(option.value), 1)
        } else {
          this.localValue.push(option.value)
        }
        this.displayVal = this.localValue.map(v => this.control.options.find(o => o.value === v).title).join(', ')
      } else {
        this.localValue = option.value
        this.displayVal = option.title
        this.showDropdown = false
      }

      this.$emit('valueUpdated', this.localValue)
      this.$emit('input', this.localValue)
    },
  },

  data () {
    return {
      showDropdown: false,
      localValue: {...{}, ...this.value},
      displayVal: this.value,
    }
  },
}
</script>

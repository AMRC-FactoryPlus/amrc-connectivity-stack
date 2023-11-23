<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div v-tooltip="'tooltip' in control ? control.tooltip : null" class="w-full flex flex-col relative" v-if="!('showControlIf' in control) || 'showControlIf'
   in control && steps[control.showControlIf.step].controls[control.showControlIf.control].value === control.showControlIf.value">

    <form-control-input :key="control.id" v-if="control.type === 'input'" :control="control" :valid="valid"
                        :value="value"
                        @valueUpdated="broadcastValueUpdated"
                        @keyUpEnter="$emit('keyUpEnter')">
    </form-control-input>
    <form-control-selection :key="control.id" v-else-if="control.type === 'selection'" :col="true" :control="control"
                            :value="value"
                            @valueUpdated="broadcastValueUpdated" @navigate="broadcastNavigation"/>
    <FormWrapper :key="control.id" v-else-if="control.type === 'dropdown'" :control="control">
      <OverflowMenu
          :valid="{}"
          :options="control.options">
        <button type="button"
                class="inline-flex justify-center w-80 border pl-4 py-2 bg-white font-medium text-gray-700 fpl-input text-left"
                id="menu-button" aria-expanded="true" aria-haspopup="true">
          <div class="flex-grow truncate">
            {{ value ? value : 'Select...' }}
          </div>
          <i class="fa-solid fa-chevron-down text-gray-400"></i>
        </button>
      </OverflowMenu>

    </FormWrapper>
    <form-control-multi-selection :key="control.id" v-else-if="control.type === 'multiSelection'" :control="control"
                                  :value="value"
                                  @valueUpdated="broadcastValueUpdated"/>
    <form-control-checkbox :key="control.id" v-else-if="control.type === 'checkbox'" :control="control" :valid="valid"
                           :value="value"
                           @valueUpdated="broadcastValueUpdated"/>

    <div v-else>
      CONTROL NOT KNOWN: {{control.type}}
    </div>
  </div>
</template>

<script>
export default {
  name: 'FormControl',
  props: {
    control: {},
    valid: {},
    steps: {},
  },

  components: {
    'FormWrapper': () => import(/* webpackPrefetch: true */ '../FormControls/FormWrapper.vue'),
    'form-control-input': () => import(/* webpackPrefetch: true */ '../FormControls/Input.vue'),
    'form-control-selection': () => import(/* webpackPrefetch: true */ '../FormControls/Selection.vue'),
    'form-control-dropdown': () => import(/* webpackPrefetch: true */ '../FormControls/Dropdown.vue'),
    'form-control-multi-selection': () => import(/* webpackPrefetch: true */ '../FormControls/MultiSelection.vue'),
    'form-control-checkbox': () => import(/* webpackPrefetch: true */ '../FormControls/Checkbox.vue'),
    'OverflowMenu': () => import(/* webpackPrefetch: true */ '../OverflowMenu.vue'),
  },

  computed: {
    value () {
      return this.control.value
    },
  },

  methods: {
    broadcastValueUpdated (value) {
      this.$emit('valueUpdated', value)
    },

    broadcastNavigation (value) {
      this.$emit('navigation', value)
    },
  },
}
</script>

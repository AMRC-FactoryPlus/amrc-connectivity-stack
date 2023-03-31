<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="grid grid-cols-3 gap-10">
    <div class="col-span-1 text-sm text-gray-400 my-auto">
      {{ control.description }}
    </div>
    <div class="col-span-2 flex flex-col">
      <div class="w-full h-7">
        <date-picker v-model="localValue" :model-config="modelConfig">
          <template #default="{ inputValue, togglePopover, hidePopover }">
            <button
                v-if="!localValue"
                class="text-sm text-brand font-semibold px-2 h-8 focus:outline-none"
                @mouseup="togglePopover"
            >
              + Add Expiry Date
            </button>
            <div class="flex flex-wrap">
              <button
                  @mouseup="togglePopover"
                  v-show="localValue"
                  class="flex items-center bg-brand bg-opacity-10 hover:bg-opacity-20 text-sm text-brand font-semibold fpl-button">
                Expires on {{ new Date(localValue).toLocaleDateString() }}
                <svg
                    v-tooltip="'Remove expiry date.'"
                    class="w-4 h-4 text-brand hover:text-indigo-600 ml-3 -mr-1"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    @mouseup="removeDate(hidePopover)"
                >
                  <path d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </template>
        </date-picker>
      </div>
    </div>
  </div>
</template>

<script>
import moment from 'moment';

export default {
  name: 'DateTimePicker',
  props: {
    control: {},
    valid: {},
    value: {}
  },

  components: {
    'date-picker': () => import(/* webpackPrefetch: true */ 'v-calendar/lib/components/date-picker.umd'),
  },

  watch: {
    localValue (val) {
      this.$emit('valueUpdated', val)
    }
  },

  methods: {
    removeDate(hide) {
      this.localValue = null;
      hide();
    },
  },

  data () {
    return {
      localValue: this.value,
      moment: moment,
      modelConfig: {
        type: 'string',
        mask: "YYYY-MM-DD",
      },
    }
  }
}
</script>
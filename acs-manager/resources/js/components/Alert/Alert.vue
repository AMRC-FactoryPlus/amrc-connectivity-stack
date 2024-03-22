<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div :key="id" class="flex flex-col items-center justify-center w-96">
    <div class="flex items-start w-full">
      <div class="ml-3 w-0 flex-1 pt-0.5 pb-3">
        <div class="flex items-center gap-x-2">
          <i class="text-sm fa-fw" :class="getIcon()"></i>
          <div class="font-medium text-gray-700">
            {{ title }}
          </div>
        </div>
        <div v-if="description" class="text-sm text-gray-500 mt-2 -mb-3">
          {{ description }}
        </div>
      </div>
      <div v-if="!loading" class="ml-4 flex-shrink-0 flex dark">
        <button @mouseup="$emit('close', id)" class="fpl-button-info">
          <i class="fa-sharp fa-solid fa-times text-lg"></i>
        </button>
      </div>
    </div>
    <div v-if="buttons && buttons.length > 0 && !loading" class="flex items-center justify-center gap-x-3 w-full mt-4">
      <button type="button"
              class="h-10 w-full"
              :key="button.text"
              v-for="button in buttons"
              @mouseup="() => {handleButtonClick(button)}"
              :class="getButtonClass(button.type ? button.type : 'secondary')">
        <div class="mr-2">{{ button.text }}</div>
      </button>
    </div>
    <div v-if="loading" class="grid grid-cols-10 gap-x-3 w-full mt-4">
      <div class="col-span-10 flex h-12 w-full items-center justify-center disabled:cursor-not-allowed rounded bg-background-light dark:bg-primary-darkest">
        <div class="text-sm">
          <div class="pr-2">
            <div class="fa-sharp fa-solid fa-circle-notch fa-spin text-primary-lightest"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Alert',

  components: {},

  props: {
    id: { required: true, type: String },
    title: { required: true, type: String, default: 'Title' },
    description: { required: true, type: String, default: 'Description' },
    type: { required: true, type: String },
    buttons: { type: Array },
  },

  watch: {
    description () {
      this.loading = false;
    },
  },

  mounted () {},

  methods: {

    getButtonClass(type) {
      switch (type) {
        case 'error': return 'fpl-button-error';
        default: return 'fpl-button-brand'
      }
    },

    handleButtonClick (button) {
      if (button.loadingOnClick) {
        this.loading = true;
      }
      if (button.isClose) {
        this.$emit('close', this.id);
      }
      if ('url' in button) {
        this.goto_url(button.url);
      } else if (typeof button.action === 'function') {
        button.action();
      }
    },

    getIcon () {
      switch (this.type) {
        case 'success':
          return 'fa-solid fa-check-circle text-success-dark';
        case 'warning':
          return 'fa-solid fa-exclamation-triangle text-orange';
        case 'error':
          return 'fa-solid fa-times-circle text-error-dark';
        default:
          return 'fa-solid fa-info-circle';
      }
    },
  },

  data () {
    return {
      loading: false,
    };
  },
};
</script>
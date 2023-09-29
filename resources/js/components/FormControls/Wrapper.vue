<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="relative grid grid-cols-3 gap-10 mb-1">
    <Transition
        enter-class="opacity-0"
        enter-active-class="ease-out duration-75"
        enter-to-class="opacity-100"
        leave-class="opacity-100"
        leave-active-class="ease-out duration-75"
        leave-to-class="opacity-0">
      <div v-show="descriptionPopupVisible"
           @click="descriptionPopupVisible = false"
           class="fixed inset-0 z-10 bg-gray-700 bg-opacity-50 transition-opacity h-screen">
        <Transition
            enter-class="opacity-0 scale-95"
            enter-active-class="ease-out duration-75"
            enter-to-class="opacity-100 scale-100"
            leave-class="opacity-100 scale-100"
            leave-active-class="ease-in duration-75"
            leave-to-class="opacity-0 scale-95">
          <div v-show="descriptionPopupVisible" @click.stop=""
               class="mx-auto text-gray-700 max-w-4xl transform -xl bg-white shadow-2xl transition-all absolute z-40 right-10 left-10 max-h-inset overscroll-contain mt-24 p-6">
            <slot name="description"></slot>
          </div>
        </Transition>
      </div>
    </Transition>
    <div class="hidden lg:inline col-span-1 text-sm text-gray-400 my-auto ml-6">
      <div class="line-clamp-2 flex">
        <button v-tooltip="'Full description'" @click.stop="showDescriptionPopup" class="fas fa-external-link-alt text-xs mr-1 text-gray-300"></button>
        <slot name="description"></slot>
      </div>
    </div>
    <div class="lg:col-span-2 col-span-3 flex flex-col">
      <div class="flex w-full relative">
        <slot name="content"></slot>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Wrapper',
  methods: {
    showDescriptionPopup() {
      this.descriptionPopupVisible = true;
    }
  },

  data() {
      return {
      descriptionPopupVisible: false,
      }
  }
};
</script>

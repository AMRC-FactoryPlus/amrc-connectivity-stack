<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div v-show="show" class="fixed flex flex-col top-24 bottom-24 justify-center items-center left-16 right-16 z-30">
    <Transition
        enter-class="opacity-0"
        enter-active-class="ease-out duration-75"
        enter-to-class="opacity-100"
        leave-class="opacity-100"
        leave-active-class="ease-out duration-75"
        leave-to-class="opacity-0">
      <div v-if="show" @mouseup="$emit('close')" class="z-10 fixed left-0 right-0 top-0 bottom-0 bg-gray-400 opacity-40"/>
    </Transition>
    <Transition
        enter-class="opacity-0 scale-95"
        enter-active-class="ease-out duration-75"
        enter-to-class="opacity-100 scale-100"
        leave-class="opacity-100 scale-100"
        leave-active-class="ease-in duration-75"
        leave-to-class="opacity-0 scale-95">
      <div v-if="show" class="z-20 w-full max-w-7xl bg-white lg:mx-16 xl:mx-32 shadow-xl py-6 px-10 max-h-full overflow-auto">
        <div class="flex items-center justify-between mb-4">
          <h3>{{ this.title }}</h3>
          <button @mouseup="$emit('close')" class="fpl-button-info">
            <i class="fa-sharp fa-solid fa-times text-lg"></i>
          </button>
        </div>
        <slot name="content"></slot>
      </div>
    </Transition>
    <!--This is used to pad out the bottom of the page-->
    <div class="w-full flex-grow"></div>
  </div>
</template>

<script>
export default {
  name: 'overlay',
  props: {
    title: { required: true, type: String },
    show: { required: true, type: Boolean|null },
  },
};
</script>


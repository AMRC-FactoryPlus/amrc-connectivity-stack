<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex">
    <form class="w-full flex md:ml-0" action="#" method="GET">
      <label for="search-field" class="sr-only">Search all files</label>
      <div class="relative w-full text-gray-400 focus-within:text-gray-600 py-2">
        <div class="pointer-events-none absolute inset-y-0 flex items-center pl-3">
          <i v-if="loading" class="fa-sharp fa-solid fa-circle-notch animate-spin"></i>
          <i v-else class="fa-sharp fa-solid fa-search"></i>
        </div>
        <input @input="onSearch" v-on:keyup.enter="onSearch" v-on:keyup.esc="clearSearch" v-model="searchText" name="search-field" id="search-field" class="bg-gray-100 focus-within:bg-gray-100 h-full w-full border-transparent py-2 pl-10 pr-3 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 focus:border-transparent focus:placeholder-gray-400" placeholder="Search">
      </div>
    </form>
  </div>
</template>

<script>
export default {
  name: 'Search',

  props: {
    property: {required: true},
    loading: {required: true, type: Boolean}
  },

  methods: {
    onSearch() {
      this.search(this);
    },

    search: _.debounce((vm) => {
      vm.requestDataReloadFor(vm.property, {search: 'search=' + vm.searchText});
      window.events.$emit('paginator-reset');
    }, 300),

    clearSearch() {
      this.searchText = '';
      this.onSearch();
    },
  },

  data() {
      return {
      searchText: '',
      }
  }
};
</script>


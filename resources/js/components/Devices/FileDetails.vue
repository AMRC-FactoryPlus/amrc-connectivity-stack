<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div>
    <div v-if="selectedFileDetailsLoading" class="animate-pulse">
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
      <div class="m-3 bg-gray-100  h-12"></div>
    </div>
    <div v-else>
      <Input :showDescription="true" :control="{description: 'Description',disabled: true,}" :valid="{}" :value="selectedFileDetails.friendly_description"></Input>
      <Input :showDescription="true" :control="{description: 'Filename',disabled: true,}" :valid="{}" :value="selectedFileDetails.filename"></Input>
      <Input :showDescription="true" :control="{description: 'Uploaded by',disabled: true,}" :valid="{}" :value="selectedFileDetails.uploader"></Input>
      <Input :showDescription="true" :control="{description: 'Uploaded',disabled: true,}" :valid="{}" :value="moment(selectedFileDetails.timestamp).fromNow()"></Input>
      <Input :showDescription="true" :control="{description: 'Type',disabled: true,}" :valid="{}" :value="selectedFileDetails.file_type.mime_type.mime"></Input>
      <h2 class="mt-10">Tags</h2>
      <Input v-for="(value, key) in selectedFileDetails.tags" :key="value" :showDescription="true" :control="{description: key ,disabled: true,}" :valid="{}" :value="value"></Input>
    </div>
  </div>
</template>

<script>
export default {
  name: 'FileDetails',

  components: {},

  props: {
    /**
     * The data object
     */
    selectedFileDetails: {
      required: true,
      type: Object | null,
    },
    
    /**
    * The device that this file is fot
    */
    device: {
      required: true,
      type: Object
    },
  },

  watch: {},

  computed: {},

  mounted () {},

  methods: {},

  data () {
    return {
      selectedFileDetailsLoading: false,
      selectedFileDetailsPreventLoad: true,
    };
  },
};
</script>
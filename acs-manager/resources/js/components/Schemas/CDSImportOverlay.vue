<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay :show="show" @close="$emit('close')" title="Import Factory+ CDS">
    <template #content>
      <cds-importer :rerender-trigger="rerenderTrigger" :schema="schema" @save="save"/>
    </template>
  </overlay>
</template>

<script>
export default {
  name: 'CDSImportOverlay',
  components: {
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
    'cds-importer': () => import(/* webpackPrefetch: true */ '../Schemas/CDSImporter.vue'),
  },
  props: {
    show: { required: true, type: Boolean },
    /**
     * The schema that we're importing to
     */
    schema: {
      required: true,
      type: Object,
    },

    /**
    * A value that changes when the metrics need to be rebuilt
    */
    rerenderTrigger: {
      required: true,
    },
  },

  methods: {
    save (mapping) {
      this.$emit('save', mapping);
    },
  },

  data () {
    return {};
  },
};
</script>
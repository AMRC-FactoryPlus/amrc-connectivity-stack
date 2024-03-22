<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div>
    <div class="w-full bg-white lg-w-2/3 pb-6 px-6 pt-4 rounded">
      <div v-for="section in this.$root.$data.userPreferences" class="mb-6 flex flex-col gap-2 my-2">
        <div class="w-full text-lg flex-grow text-gray-700 border-b border-background-light">
          {{ section.sectionTitle }}
        </div>
        <div class="grid gap-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-6" v-for="preference in section.preferences">
          <preference :section="section"
                      :preference="preference"></preference>
        </div>
        <div v-for="subsection in section.subsections" class="mb-6 flex flex-col gap-2 my-2">
          <div class="text-md w-full text-gray-400">{{ subsection.subSectionTitle }}</div>
          <div class="grid gap-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" v-for="preference in subsection.preferences">
            <preference :section="section" :subsection="subsection"
                        :preference="preference"></preference>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Preference from "@/resources/js/components/General/Preference.vue";

export default {
  name: "PreferencesContainer",

  components: {Preference},

  props: {},

  watch: {},

  computed: {},

  mounted() {
  },

  methods: {},

  data() {
    return {};
  },
}
</script>
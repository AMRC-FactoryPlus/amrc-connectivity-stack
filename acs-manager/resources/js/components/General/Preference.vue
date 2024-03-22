<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div>
    <Checkbox v-if="preference.type === 'bool'" v-model="localValue"
              :valid="{}"
              :control="{
                        name: preference.title,
                        description: preference.description
            }"/>
  </div>

</template>

<script>
import Checkbox from "@/resources/js/components/FormControls/Checkbox.vue";

export default {
  components: {Checkbox},

  props: {
    /**
    * The preference
    */
    preference: {
      required: true,
      type: Object
    },

    /**
    * The section
    */
    section: {
      required: false,
    },

    /**
    * The subsection
    */
    subsection: {
      required: false,
    },
  },

  created() {
    this.localValue = this.preference.value;
  },

  watch: {

    localValue: function(newVal, oldVal) {
      if (oldVal === null) {
        return;
      }
      this.updateStandardPreference(newVal)
    },
  },

  methods: {
    updateStandardPreference(data) {

      if (!this.subsection) {
        this.preferenceString = this.section.sectionName + '.' + this.preference.name;
      } else {
        this.preferenceString = this.section.sectionName + '.' + this.subsection.subSectionName + '.' + this.preference.name;
      }

      // Change session data property for instant changes
      if (!this.subsection) {
        this.$root.$data.userPreferences[this.section.sectionName].preferences[this.preference.name].value = data;
      } else {
        this.$root.$data.userPreferences[this.section.sectionName].subsections[this.subsection.subSectionName].preferences[this.preference.name].value = data;
      }

      // Submit request to change property
      axios.post('/api/user/set-preference', {
        'revisions': {[this.preferenceString]: data},
      }).then((response) => {
        window.showNotification({
            title: 'Updated',
            description: 'Preference update saved.',
            type: 'success',
        });
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        window.showNotification({
          title: 'Failed',
          description: 'Failed to update preference.',
          type: 'error',
          id: 'b4f9dca1-e287-47a7-874e-ff56201bde73',
        });
      });
    },
  },

  data() {
    return {
      localValue: null,
      preferenceString: null,
    };
  },
};
</script>
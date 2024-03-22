<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div v-if="selectedFolder">
    <Wrapper>
      <template #description>
        The name of the folder
      </template>
      <template #content>
        <div class="p-4 w-full">
          <Input :showDescription="false"
                 :control="{name: 'Name',}"
                 :valid="{}"
                 :value="localName"
                 @input="updateFolderName"
          ></Input>
        </div>
      </template>
    </Wrapper>
  </div>
</template>

<script>
export default {

  name: 'FolderEditPanel',

  components: {
    'Dropdown': () => import(/* webpackPrefetch: true */ '../FormControls/Dropdown.vue'),
  },

  props: {
    /**
     * The details of the folder
     */
    selectedFolder: {
      type: Object,
      default: () => {
        return {}
      },
    },
  },

  watch: {
    'selectedFolder.uuid': {
      handler (val) {
        this.selectFolder()
      },
    },
  },

  methods: {

    updateFolderName (e) {
      this.localName = e
      this.$emit('updateFolderName', this.localName)
    },

    selectFolder () {
      this.localName = this.selectedFolder?.name
      this.localUuid = this.selectedFolder?.uuid
    },
  },

  data () {
    return {
      localName: this.selectedFolder?.name,
      localUuid: this.selectedFolder?.uuid,
    }
  },
}
</script>


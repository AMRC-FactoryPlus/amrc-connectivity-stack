<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex-1 px-4 py-2 text-sm truncate h-16 flex items-center">
    <div v-if="item.metadata.labels['factory-plus.app'] === 'edge-agent'"
         class="mr-2 inline-flex items-center justify-center w-12 text-center py-0.5 text-sm font-medium bg-brand/10 text-brand">
      Cell
    </div>
    <div v-if="item.metadata.labels['factory-plus.app'] === 'soft-edge-agent'"
         class="mr-2 inline-flex items-center justify-center w-12 text-center py-0.5 text-sm font-medium bg-green-100 text-green-800">
      Soft
    </div>
    <a href="#" class="text-gray-500 font-semibold">{{ item.metadata.labels['factory-plus.name'] }}</a>
    <div class="flex-1"></div>
    <div class="flex gap-3 items-center">
      <div v-if="item.status.conditions.find(e => e.type === 'Available').status === 'False'" class="mr-2 inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-red-500/10 text-red-500 gap-2">
        <div>DEPLOYING</div>
        <i class="fa-solid fa-circle-notch fa-spin"></i>
      </div>
      <div class="mr-2 inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-brand/10 text-brand">
        {{ item.spec.template.spec.containers[0].image.split(":")[item.spec.template.spec.containers[0].image.split(":").length-1] }}
      </div>
      <i class="fa-solid fa-arrow-right text-gray-400"></i>
      <TextField class="mb-2" placeholder="New version" v-model="v$.newVersion.$model" :valid="v$">
        <template #info>
          <button v-tooltip="'Apply version'" v-if="!isInvalid" :disabled="!newVersion" type="button"
                  @click="maybeApply"
                  class="fpl-button-secondary w-3 h-5 disabled:opacity-50 hover:!text-gray-700">
            <i class="fa-fw text-xs fa-sharp fa-solid fa-download"></i>
          </button>
        </template>
      </TextField>
    </div>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core';
import {helpers} from '@vuelidate/validators';

export default {

  setup() {
    return {v$: useVuelidate({$stopPropagation: true})};
  },

  name: "EdgeAgentEntry",

  components: {
    'TextField': () => import(/* webpackPrefetch: true */ '../TextField.vue'),
  },

  props: {
    /**
     * The item
     */
    item: {
      required: true,
      type: Object
    },
  },

  watch: {},

  computed: {
    isInvalid() {
      return this.v$.$dirty && this.v$.$invalid === true
    }
  },

  mounted() {
  },

  methods: {

    maybeApply() {
      if (this.isInvalid) return;

      window.showNotification({
        title: 'Are you sure?',
        description: 'This will overwrite the edge agent version this node.',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Update', type: 'error', loadingOnClick: true, action: () => {
              this.apply()
            },
          },
          {text: 'Cancel', isClose: true}
        ],
        id: '549cdd79-c6dc-4dd1-a2b8-d228a5845205',
      });
    },

    apply() {
      if (this.isInvalid) return;

      axios.post(`/api/edge-agents/${this.item.metadata.namespace}/${this.item.metadata.name}`, {
        version: this.newVersion,
      }).then(e => {
        window.showNotification({
          title: 'Update applied',
          description: 'The results may take some time to show here, depending on how quickly K8s applies the changes.',
          type: 'success'
        });
        this.newVersion = null;
        this.requestDataReloadFor('edgeAgents');
        window.hideNotification({id: '549cdd79-c6dc-4dd1-a2b8-d228a5845205'});
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        this.handleError(error);
      })
    }
  },

  data() {
    return {
      newVersion: null,
    };
  },

  validations() {
    return {
      newVersion: {
        regex: helpers.withMessage('Must be semver', helpers.regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/)),
      }
    };
  },
}
</script>

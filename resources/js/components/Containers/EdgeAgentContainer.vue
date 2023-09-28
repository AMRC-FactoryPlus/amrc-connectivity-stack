<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="grid grid-cols-1 flex-grow bg-gray-100 overflow-auto">
    <!--Edge Agents-->
    <ColumnList class="px-4" @selected="selectEdgeAgent"
                :show-search="false"
                property="edgeAgents"
                :loading="edgeAgentsLoading" :items="edgeAgents"
                name="Edge Agents">
      <template #admin-actions>
        <div class="flex gap-3 items-center">
          <div class="mr-2 inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-red-500/10 text-red-500">
            Update all
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
      </template>
      <template v-slot:item="{ item }">
        <EdgeAgentEntry :item="item"></EdgeAgentEntry>
      </template>
    </ColumnList>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core';
import {helpers} from '@vuelidate/validators';

export default {
  setup() {
    return {v$: useVuelidate({$stopPropagation: true})};
  },

  name: 'TranslatorsContainer',

  computed: {
    isInvalid() {
      return this.v$.$dirty && this.v$.$invalid === true
    }
  },

  components: {
    'ColumnList': () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
    'EdgeAgentEntry': () => import(/* webpackPrefetch: true */ '../EdgeAgents/EdgeAgentEntry.vue'),
    'TextField': () => import(/* webpackPrefetch: true */ '../TextField.vue'),
  },

  props: {
    initialData: {},
  },

  watch: {
    selectedEdgeAgent() {
      this.selectedNode = null;
      this.selectedDevice = null;
    },

  },

  mounted() {
    this.initialiseContainerComponent();
  },

  methods: {
    selectEdgeAgent(group) {
      this.selectedEdgeAgent = group;
      this.nodesRouteVar = {group: this.selectedEdgeAgent.id};
      this.requestDataReloadFor('nodes');
    },

    maybeApply() {
      if (this.isInvalid) return;

      window.showNotification({
        title: 'Are you sure?',
        description: 'This will overwrite the edge agent version for all soft and cell gateways. There is no way to undo this.',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Update All', type: 'error', loadingOnClick: true, action: () => {
              this.apply()
            },
          },
          {text: 'Cancel', isClose: true}
        ],
        id: 'e9e52913-a393-4031-b37c-4704813729e4',
      });
    },

    apply() {
      if (this.isInvalid) return;

      axios.post(`/api/edge-agents/`, {
        version: this.newVersion,
      }).then(e => {
        window.showNotification({
          title: 'Update applied',
          description: 'The results may take some time to show here, depending on how quickly K8s applies the changes.',
          type: 'success'
        });
        this.newVersion = null;
        this.requestDataReloadFor('edgeAgents');
        window.hideNotification({id: 'e9e52913-a393-4031-b37c-4704813729e4'});
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
      isContainer: true,

      newVersion: null,

      // edgeAgents
      edgeAgents: null,
      edgeAgentsLoading: false,
      edgeAgentsLoaded: false,
      edgeAgentsQueryBank: null,
      edgeAgentsRouteVar: null,
      edgeAgentsForceLoad: true,
      selectedEdgeAgent: null,
    };
  },

  validations() {
    return {
      newVersion: {
        regex: helpers.withMessage('Must be semver', helpers.regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/)),
      }
    };
  },
};
</script>

<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay
      :show="show"
      @close="$emit('close')"
      title="New Node">
    <template
        #content>
      <wizard
          :data-steps="steps"
          data-first-step="nodeSelection"
          @complete="completed"></wizard>
    </template>
  </overlay>
</template>

<script>
import {
  minLength,
  required,
  helpers,
  requiredIf,
} from '@vuelidate/validators'

export default {
  name: 'NewNodeOverlay',
  components: {
    'wizard': () => import(/* webpackPrefetch: true */ '../General/Wizard.vue'),
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
  },
  props: {
    group: {
      required: true,
      type: Object,
    },
    show: {
      required: true,
      type: Boolean,
    },
    edgeClusters: {
      required: true,
    },
  },

  watch: {
    show: {
      immediate: true,
      handler: function (val) {
        if (val) {
          this.requestDataReloadFor('edgeClusters')
        }
      },
    },

    edgeClusters: {
      immediate: true,
      handler: function (val) {
        if (val) {
          this.steps.nodeSelection.controls.destination_node.options = Object.keys(val).map((edgeCluster) => {
            return {
              title: edgeCluster,
              value: edgeCluster,
              options: Object.keys(val[edgeCluster].nodes).map(e => {
                return {
                  title: val[edgeCluster].nodes[e].hostname,
                  value: val[edgeCluster].nodes[e].hostname,
                  action: () => {
                    this.steps.__request.parameters.destination_cluster.data = val[edgeCluster].uuid
                    this.steps.__request.parameters.destination_node.data = val[edgeCluster].nodes[e].hostname
                    this.steps.nodeSelection.controls.destination_node.value = val[edgeCluster].nodes[e].hostname
                  },
                }
              })
            }
          })
          this.$forceUpdate();
        }
      },
    },

  },

  methods: {

    completed (response) {
      this.$emit('complete', response)
      this.requestDataReloadFor('nodes')
      window.showNotification({
        title: 'Success',
        description: 'The node has been created and the edge agent has been deployed.',
        type: 'success',
      })
    },
  },

  data () {
    return {
      steps: {
        __request: {
          startAction: () => {
            this.steps.__request.url = '/api/groups/' + this.group.id + '/nodes/new'
          },
          type: 'post',
          url: 'replaced',
          parameters: {
            node_name: {
              dataType: 'collected',
              dataSource: ['nodeSelection', 'controls', 'node_name', 'value'],
              data: null,
            },
            destination_cluster: {
              dataType: 'static',
              data: null,
            },
            destination_node: {
              dataType: 'static',
              data: null,
            },
          },
        },
        nodeSelection: {
          tagline: 'Choose the edge cluster and node on which to deploy the new node',
          controls: {
            node_name: {
              name: 'Node Name',
              description: 'Node names must use underscores for spaces.',
              prefix: '',
              placeholder: 'e.g. Assembly_Cell',
              type: 'input',
              validations: {
                required: helpers.withMessage('Please enter a Node name', required),
                minLength: minLength(5),
                valid: helpers.withMessage('This Node name does not conform to the naming convention',
                    helpers.regex(/^[\w_]+$/i)),
              },
              initialValue: '',
              value: ''
            },
            destination_node: {
              name: 'Destination Node',
              description: 'Choose a remote cluster and edge device on which to deploy the new Sparkplug node.',
              type: 'dropdown',
              options: [],
              validations: {
                required: helpers.withMessage('Please choose an edge node', required),
              },
              disabled: false,
              initialValue: '',
              value: '',
            },
          },
          buttons: [
            {
              text: 'Create Node',
              icon: 'fa-sharp fa-solid fa-plus',
              actionMethod: 'submit',
              primary: true,
            },
          ],
        },
      },
    }
  },
}
</script>


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
    helmChartTemplates: {
      required: true,
    },
    defaultHelmChartTemplates: {
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

    helmChartTemplates: {
      immediate: true,
      handler: function (val) {
        if (val) {
          this.buildHelmChartTemplateOptions();
        }
      },
    },

    edgeClusters: {
      immediate: true,
      handler: function (val) {
        if (val) {
          const control = this.steps.nodeSelection.controls.destination_node;
          const params = this.steps.__request.parameters;
          control.options = Object.entries(val).filter(([edgeCluster, config]) => config.status).map(([edgeCluster, config]) => {
            let payload = {
              title: edgeCluster,
              value: edgeCluster,
              options: config.status.hosts.map(host => {
                const special = host.specialised ? ` [${host.specialised}]` : "";
                return {
                  title: `${host.hostname}${special}`,
                  value: host.hostname,
                  action: () => {
                    params.destination_cluster.data = config.uuid;
                    params.destination_node.data = host.hostname;
                    control.value = `${edgeCluster} / ${host.hostname}`;
                  },
                }
              })
            }

            // Add a `Floating Node` option to the very beginning of the list
            payload.options.unshift({
              title: 'Floating',
              value: 'floating',
              action: () => {
                params.destination_cluster.data = config.uuid;
                params.destination_node.data = '';
                control.value = `${edgeCluster} / Floating`;
              },
            })

            return payload;
          })

          this.$forceUpdate();
        }
      },
    },

  },

  methods: {

    buildHelmChartTemplateOptions() {
      this.steps.nodeSelection.controls.charts.options = Object.keys(this.helmChartTemplates).map((helmChartTemplate) => {
        return {
          title: this.helmChartTemplates[helmChartTemplate].name,
          value: helmChartTemplate,
          action: () => {
            this.steps.__request.parameters.charts.data = helmChartTemplate
            this.steps.nodeSelection.controls.charts.value = this.helmChartTemplates[helmChartTemplate].name
          },
        }
      })
      this.$forceUpdate();

    },

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
            charts: {
              dataType: 'collected',
              dataSource: ['nodeSelection', 'controls', 'charts', 'value'],
              data: null,
            },
          },
        },
        nodeSelection: {
          tagline: 'Choose the edge cluster and node on which to deploy the new node',
          controls: {
            node_name: {
              name: 'Node Name',
              description: 'Node names must use underscores for spaces',
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
              description: 'Choose a remote cluster and edge device on which to deploy the new Sparkplug node',
              type: 'dropdown',
              options: [],
              validations: {
                required: helpers.withMessage('Please choose an edge node', required),
              },
              disabled: false,
              initialValue: '',
              value: '',
            },
            charts: {
              name: 'Helm Charts',
              description: 'Choose the Helm charts to deploy to the edge cluster',
              type: 'multiSelection',
              options: [],
              validations: {
                required: helpers.withMessage('Please choose a chart', required),
              },
              disabled: false,
              initialValue: [],
              value: [],
            }
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


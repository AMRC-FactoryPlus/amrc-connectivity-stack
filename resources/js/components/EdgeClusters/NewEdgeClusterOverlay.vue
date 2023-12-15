<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay
      :show="show"
      @close="$emit('close')"
      title="New Edge Cluster">
    <template
        #content>
      <wizard
          :data-steps="steps"
          data-first-step="clusterConfiguration"
          @complete="completed"></wizard>
    </template>
  </overlay>
</template>

<script>
import { helpers, minLength, required } from '@vuelidate/validators'

export default {
  name: 'NewEdgeClusterOverlay',
  components: {
    'wizard': () => import(/* webpackPrefetch: true */ '../General/Wizard.vue'),
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
  },
  props: {
    show: {
      required: true,
      type: Boolean,
    },
  },

  methods: {

    completed (response) {
      this.$emit('complete', response)
      this.requestDataReloadFor('edgeClusters')
      window.showNotification({
        title: 'Success',
        description: 'The edge cluster has been created.',
        type: 'success',
      })
    },
  },

  data () {
    return {
      steps: {
        __request: {
          type: 'post',
          url: '/api/edge-clusters',
          parameters: {
            name: {
              dataType: 'collected',
              dataSource: ['clusterConfiguration', 'controls', 'name', 'value'],
              data: null,
            },
          },
        },
        clusterConfiguration: {
          tagline: 'Let\'s create a new edge cluster for Cell Gateways out on the factory floor.',
          controls: {
            name: {
              name: 'Cluster Name',
              description: 'What is the name of this new cluster?',
              prefix: '',
              placeholder: 'e.g. Building A',
              type: 'input',
              validations: {
                required: helpers.withMessage('Please enter a cluster name', required),
                minLength: minLength(1),
              },
              initialValue: '',
              value: '',
            },
          },
          buttons: [
            {
              text: 'Create Edge Cluster',
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


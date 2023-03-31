<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay v-if="clusters" :show="show" @close="$emit('close')" title="New Group">
    <template #content>
      <wizard :data-steps="steps" data-first-step="name" @complete="completed"></wizard>
    </template>
  </overlay>
</template>

<script>
import {minLength, required, helpers} from '@vuelidate/validators';

export default {
  name: 'NewGroupOverlay',
  components: {
    'wizard': () => import(/* webpackPrefetch: true */ '../General/Wizard.vue'),
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue')
  },
  props: {
    show: {required: true, type: Boolean},

    /**
     * The list of available clusters where this group can exist
     */
    clusters: {
      required: true,
    },
  },

  watch: {
    clusters: {
      handler(val) {
        this.steps.name.controls.cluster.options = val.map((e) => {
          return {
            title: e.name,
            value: e.id,
          };
        })
      }, deep: true
    },

    'steps.name.controls.cluster.value': function (newVal, oldVal) {
      this.steps.name.controls.name.placeholder = 'e.g. F2050-Mazak-2';
      this.steps.name.controls.name.prefix = this.clusters.find(e => e.id === newVal).name + '-';

    },
  },

  methods: {
    completed(response) {
      this.$emit('completed', response);
    }
  },

  data() {
    return {
      steps: {
        __request: {
          startAction: () => {
            this.steps.__request.parameters.name.data = this.steps.name.controls.name.prefix + this.steps.name.controls.name.value;
          },
          type: 'post',
          url: '/api/groups/new',
          parameters: {
            name: {
              dataType: 'static',
              data: null
            },
            cluster_id: {
              dataType: 'collected',
              dataSource: ['name', 'controls', 'cluster', 'value'],
              data: null
            }
          }
        },
        name: {
          startAction: () => {
          },
          tagline: 'Let\'s create a new group. What should it be called?',
          controls: {
            cluster: {
              name: 'Cluster',
              description: 'Choose the cluster where this Group is located.',
              type: 'dropdown',
              options: [],
              validations: {
                required: helpers.withMessage('Please enter a cluster', required),
              },
              initialValue: '',
              value: ''
            },
            name: {
              name: 'Group Name',
              description: 'Group names must comply with the naming convention outlined in the Factory+ specification.',
              prefix: '',
              placeholder: 'e.g. AMRC-F2050-Mazak-2',
              infoLink: 'https://factoryplus.app.amrc.co.uk/core-framework/framework/messages-payload/framework-protocol#topic-structure',
              infoTooltip: 'Read naming convention',
              type: 'input',
              validations: {
                required: helpers.withMessage('Please enter a Group name', required),
                minLength: minLength(5),
                valid: helpers.withMessage('This Group name does not conform to the naming convention',
                    helpers.regex(/^\w+-\w+(:?-\d+)?$/i)),
              },
              initialValue: '',
              value: ''
            },
          },
          buttons: [
            {
              text: 'Create Group',
              icon: 'fa-sharp fa-solid fa-plus',
              actionMethod: 'submit',
              primary: true
            }
          ]
        }
      }
    };
  }
};
</script>


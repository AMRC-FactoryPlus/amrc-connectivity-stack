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
          data-first-step="nodeType"
          @complete="completed"></wizard>
    </template>
  </overlay>
</template>

<script>
import {
  minLength,
  required,
  helpers,
  requiredIf
} from '@vuelidate/validators';

export default {
  name: 'NewNodeOverlay',
  components: {
    'wizard': () => import(/* webpackPrefetch: true */ '../General/Wizard.vue'),
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
  },
  props: {
    group: {
      required: true,
      type: Object
    },
    show: {
      required: true,
      type: Boolean
    },
    roles: {required: true},
  },

  watch: {
    roles: {
      handler(newVal) {
        if (newVal) {
          // Populate the Principal Roles, filtering out the Gateway Bridge and Global Primary roles
          this.steps.principalRole.controls.principalRole.options = [];
          newVal.filter(e => {
            return e.is_principal === 1 && e.id !== '3fe2f56d-ac3a-418e-98c1-35ef220d71b0' && e.id !== '5763ae12-dfe3-46ca-a456-12a4b65c5b14';
          }).forEach(role => {
            this.steps.principalRole.controls.principalRole.options.push(
                {
                  title: role.name,
                  description: role.description,
                  icon: role.icon,
                  value: role.id,
                },
            );
          });

          // Populate the Supplemental Roles
          newVal.filter(e => e.is_principal === 0).forEach(role => {
            this.steps.supplementalRoles.controls.supplementalRoles.options.push({
              id: role.id,
              title: role.name,
              description: role.privileges.map(e => e.name).join(', '),
              icon: '',
              value: role.name,
            });
          });
        }
      },
      deep: true,
    },

    group: {
      handler(newVal) {
        this.steps.nodeType.controls.nodeType.options.find(e => e.title === 'Soft Gateway').disabled =
            !newVal?.cluster?.has_central_agents;
      },
      deep: true
    }
  },

  methods: {

    copyToClipboard(str) {
      const el = document.createElement('textarea');
      el.value = str;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    },

    completed(response) {
      this.$emit('complete', response);
      this.requestDataReloadFor('nodes');
      window.showNotification({
        title: 'Success',
        description: 'The node has been created and the edge agent has been deployed.',
        type: 'success',
      });
    },
  },

  data() {
    return {
      supplementalRolesLoading: false,
      supplementalRolesPreventLoad: true,
      steps: {
        __request: {
          startAction: () => {
            this.steps.__request.url = '/api/groups/' + this.group.id + '/nodes/new';
            this.steps.__request.parameters.is_cell_gateway.data = +(this.steps.nodeType.controls.nodeType.value === 'cell');
            this.steps.__request.parameters.supplemental_roles.data = JSON.stringify(this.steps.supplementalRoles.controls.supplementalRoles.value);
          },
          type: 'post',
          url: 'replaced',
          parameters: {
            is_cell_gateway: {
              dataType: 'static',
              data: null,
            },
            enabled: {
              dataType: 'collected',
              dataSource: ['settings', 'controls', 'enabled', 'value'],
              translator: {
                type: 'bool',
              },
              data: null,
            },
            node_id: {
              dataType: 'collected',
              dataSource: ['settings', 'controls', 'node_id', 'value'],
              data: null,
            },
            node_hostname: {
              dataType: 'collected',
              dataSource: ['settings', 'controls', 'hostname', 'value'],
              data: null,
            },
            expiry: {
              dataType: 'collected',
              dataSource: ['settings', 'controls', 'expiry', 'value'],
              data: null,
            },
            principal_role: {
              dataType: 'collected',
              dataSource: ['principalRole', 'controls', 'principalRole', 'value'],
              data: null,
            },
            supplemental_roles: {
              dataType: 'static',
              data: [],
            },
          },
        },
        nodeType: {
          tagline: 'What type of node do you want to create?',
          nextStep: 'settings',
          controls: {
            nodeType: {
              name: 'Node Type',
              type: 'selection',
              options: [
                {
                  title: 'Cell Gateway',
                  description: 'Create a Cell Gateway node to onboard a new cell onto Factory+',
                  icon: 'fa-sharp fa-solid fa-network-wired',
                  value: 'cell',
                },
                {
                  title: 'Soft Gateway',
                  description: 'Create a Soft Gateway node to connect devices that are not logically contained within a cell to Factory+. This will run an Edge Agent within the Factory+ cluster.',
                  icon: 'fa-sharp fa-solid fa-code',
                  value: 'soft',
                  disabled: !this.group?.cluster?.has_central_agents,
                },
                // {
                //   title: 'Other Node',
                //   description: 'Create a new node with a principal role and set of supplemental roles of your choosing',
                //   icon: 'fa-sharp fa-solid fa-ellipsis-h',
                //   value: 'other',
                // },
              ],
              validations: {},
              initialValue: '',
              value: '',
            },
          },
        },
        settings: {
          startAction: () => {
            // Manually set the Node ID if we're creating a gateway
            switch (this.steps.nodeType.controls.nodeType.value) {
              case 'cell':
                this.steps.settings.controls.node_id.value = 'Cell_Gateway';
                break;
              case 'soft':
                this.steps.settings.controls.node_id.value = 'Soft_Gateway';
                break;
              default:
                this.steps.settings.controls.node_id.value = '';
                this.steps.settings.controls.node_id.disabled = false;
            }

            this.steps.settings.buttons[0].text = ['cell', 'soft'].includes(this.steps.nodeType.controls.nodeType.value) ? 'Create Node' : 'Next';
            this.steps.settings.buttons[0].icon = ['cell', 'soft'].includes(this.steps.nodeType.controls.nodeType.value) ? 'fa-sharp fa-solid fa-plus' : 'fa-sharp fa-solid fa-arrow-right';
            this.steps.settings.buttons[0].actionMethod = ['cell', 'soft'].includes(this.steps.nodeType.controls.nodeType.value) ? 'submit' : 'nextStep';
          },
          tagline: 'Now define the settings for the new node.',
          nextStep: 'principalRole',
          previousStep: 'nodeType',
          controls: {
            expiry: {
              name: 'Node Expiry',
              description: 'Define when this node should expire. Leave blank to never expire.',
              placeholder: '',
              type: 'time',
              validations: {},
              initialValue: '',
              value: '',
            },
            node_id: {
              name: 'Node ID',
              description: 'The Node ID must be unique within the group and must comply with the naming convention outlined in the Factory+ specification.',
              placeholder: 'e.g. Siemens_Opcenter',
              infoLink: 'https://factoryplus.app.amrc.co.uk/core-framework/framework/messages-payload/framework-protocol#topic-structure',
              infoTooltip: 'Read naming convention',
              type: 'input',
              disabled: false,
              validations: {
                required,
                minLength: minLength(5),
                nodeIDValid: helpers.withMessage('The Node ID does not conform to the Factory+ specifiction.', helpers.regex(/^\w+$/i)),
              },
              initialValue: '',
              value: '',
            },
            hostname: {
              showControlIf: {
                step: 'nodeType',
                control: 'nodeType',
                value: 'cell'
              },
              name: 'Kubernetes Node Name',
              description: 'This must be identical to the name of the node in the Kubernetes cluster',
              placeholder: 'e.g. lenpf3np1n9',
              type: 'input',
              disabled: false,
              validations: {
                required: requiredIf(function () {
                  return this.steps.nodeType.controls.nodeType.value === 'cell'
                }),
                minLength: minLength(1),
              },
              initialValue: '',
              value: '',
            },
            enabled: {
              name: 'Enabled',
              description: 'Define if this node should be active',
              type: 'checkbox',
              initialValue: true,
              value: true,
              validations: {},
            },
          },
          buttons: [
            {
              text: 'Next',
              icon: 'fa-sharp fa-solid fa-arrow-right',
              actionMethod: 'nextStep',
              primary: true,
            },
          ],
        },
        principalRole: {
          startAction: () => {
            if (this.roles === null) {
              this.requestDataReloadFor('roles');
            }
          },
          skipStepIf: () => {
            return ['cell', 'soft'].includes(this.steps.nodeType.controls.nodeType.value);
          },
          tagline: 'Define the principal role of the node.',
          nextStep: 'supplementalRoles',
          previousStep: 'settings',
          controls: {
            principalRole: {
              name: 'Principal Role',
              type: 'selection',
              options: [],
              validations: {},
              initialValue: '',
              value: '',
            },
          },
        },
        supplementalRoles: {
          skipStepIf: () => {
            return ['cell', 'soft'].includes(this.steps.nodeType.controls.nodeType.value);
          },
          tagline: 'Assign any supplemental roles to the node.',
          previousStep: 'principalRole',
          controls: {
            supplementalRoles: {
              name: 'Supplemental Roles',
              type: 'multiSelection',
              options: [],
              validations: {},
              initialValue: [],
              value: [],
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
    };
  },
};
</script>


<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col">
    <Loader v-if="deviceConnectionLoading"></Loader>
    <div v-else class="flex flex-col">
      <div class="p-2 mb-2  flex flex-col" v-for="element in controls" v-if="'showIf' in element.object ? element.object.showIf() : true">
        <Wrapper>
          <template #description>
            {{ element.object.description }}
          </template>
          <template #content>
            <div class="flex flex-col flex-grow">
              <h4 v-if="element.object.type !== 'boolean'" class="h-7">
                {{ (element.namePath.length > 0 ? (element.namePath.join(' > ') + ' > ') : '') + element.object.title }}</h4>
              <Input v-if="(['string', 'number'].includes(element.object.type)) && !('enum' in element.object)" :showDescription="false"
                     :control="{}"
                     :valid="get(element.keyPath.filter(e => e !== 'properties').join('.'), v.model)"
                     :value="get(element.keyPath.filter(e => e !== 'properties').join('.'), model)"
                     @input="updateInput(element, $event)"></Input>
              <Input :password="true" v-else-if="(['password'].includes(element.object.type)) && !('enum' in element.object)"
                     :showDescription="false"
                     :control="{}"
                     :valid="get(element.keyPath.filter(e => e !== 'properties').join('.'), v.model)"
                     :value="get(element.keyPath.filter(e => e !== 'properties').join('.'), model)"
                     @input="updateInput(element, $event)"></Input>
              <Dropdown @input="updateInput(element, $event)"
                        v-else-if="['string', 'number'].includes(element.object.type) && ('enum' in element.object)"
                        :valid="get(element.keyPath.filter(e => e !== 'properties').join('.'), v.model)"
                        :value="get(element.keyPath.filter(e => e !== 'properties').join('.'), model)"
                        :control="{
              options: element.object.enum.map(e => {return {
              title: e === '' ? 'None' : e,
              value: e
            }})
            }"></Dropdown>
              <Checkbox @input="updateInput(element, $event)" v-else-if="element.object.type === 'boolean'"
                        :valid="get(element.keyPath.filter(e => e !== 'properties').join('.'), v.model)"
                        :value="get(element.keyPath.filter(e => e !== 'properties').join('.'), model)"
                        :control="{
                        name: element.object.title,
                        description: element.object.description
            }"/>
              <div class="px-2 py-1 bg-red-100  text-red-400 mr-auto" v-else>CONTROL NOT SUPPORTED: {{ element.object.type }}</div>
            </div>
          </template>
        </Wrapper>
      </div>
      <div class="flex items-center justify-end">
        <!--        <button @mouseup="save(false)" :disabled="(v && v.$invalid)" class="fpl-button-secondary h-10 mt-6">-->
        <!--          <div v-if="loading === false" class="text-base mr-3 ml-10 flex items-center justify-center whitespace-nowrap">-->
        <!--            Save Draft-->
        <!--            <i class="fa-sharp fa-solid fa-save ml-2"></i>-->
        <!--          </div>-->
        <!--          <i v-if="loading === false" class="mr-10"></i>-->
        <!--          <div v-else class="w-12">-->
        <!--            <i class="fa-sharp fa-solid fa-circle-notch fa-spin"></i>-->
        <!--          </div>-->
        <!--        </button>-->
        <button @mouseup="save(true)" :disabled="(v && v.$invalid)" class="fpl-button-brand h-10 ml-2 mt-6"
                :class="loading ? '!bg-opacity-50' : ''">
          <div v-if="loading === false" class="text-base mr-3 ml-10 flex items-center justify-center">
            Save & Activate
            <i class="fa-sharp fa-solid fa-arrow-right ml-2"></i>
          </div>
          <i v-if="loading === false" class="mr-10"></i>
          <div v-else class="w-12">
            <i class="fa-sharp fa-solid fa-circle-notch fa-spin"></i>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core';
import {required, minLength, maxLength, numeric, requiredIf, helpers} from '@vuelidate/validators';

export default {
  setup() {
    return {v: useVuelidate()};
  },
  name: 'DeviceConnectionForm',

  components: {
    'Dropdown': () => import(/* webpackPrefetch: true */ './../FormControls/Dropdown.vue'),
    'Checkbox': () => import(/* webpackPrefetch: true */ './../FormControls/Checkbox.vue'),
    'form-control': () => import(/* webpackPrefetch: true */ './FormControl.vue'),
  },

  props: {
    device: {
      required: true,
      type: Object,
    },
    deviceConnection: {
      required: true,
      type: Object,
    },
  },

  created() {
    if (this.deviceConnection.file) {
      // Get the existing model
      this.deviceConnectionLoading = true;
      axios.get(`/api/groups/${this.device.node.group.id}/nodes/${this.device.node}/connections/${this.device?.device_connection_id}`).then((r) => {
        this.model = {...this.model, ...r.data.data};
        this.deviceConnectionLoading = false;
      }).catch(error => {
        this.deviceConnectionLoading = false;
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        this.handleError(error);
      });
    }
    // Get every element that has a 'type' key and NO properties field - that's our control
    this.deepProcessKeys(this.schema);
  },

  methods: {
    processCast(value, type) {
      switch (type) {
        case 'string':
        case 'password':
          return String(value);
        case 'number':
          return Number(value);
        case 'boolean':
          return Boolean(value);
        default:
          return value;
      }
    },

    updateInput(element, val) {
      // Set the underlying value
      this.set(element.keyPath.filter(e => e !== 'properties').join('.'), val, this.model);
    },

    get(path, obj) {
      let schema = obj;  // a moving reference to internal objects within obj
      const pList = path.split('.');
      const len = pList.length;
      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i];
        if (!schema[elem]) schema[elem] = {};
        schema = schema[elem];
      }

      return schema[pList[len - 1]];
    },
    set(path, value, obj) {
      let schema = obj;  // a moving reference to internal objects within obj
      const pList = path.split('.');
      const len = pList.length;

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i];
        if (!schema[elem]) schema[elem] = {};
        schema = schema[elem];
      }
      this.$set(schema, pList[len - 1], value);
    },
    unset(path, obj) {
      let schema = obj;  // a moving reference to internal objects within obj
      const pList = path.split('.');
      const len = pList.length;

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i];
        if (!schema[elem]) schema[elem] = {};
        schema = schema[elem];
      }
      delete schema[pList[len - 1]];
    },

    deepProcessKeys(obj, keyPath = [], namePath = []) {
      if (obj && typeof obj === 'object') {
        let allKeys = Object.keys(obj);
        let isParent = false;
        let hasType = false;
        let hasTitle = false;
        let validations = {};
        for (let i = 0; i < allKeys.length; i++) {
          let k = allKeys[i];
          let value = obj[k];
          if (k === 'properties') {
            isParent = true;
          }
          if (k === 'type') {
            hasType = true;
          }
          if (k === 'title') {
            hasTitle = true;
          }
          if (k === 'validations') {
            validations = value;
          }
          if (typeof value === 'object') {
            keyPath.push(k);
            if (obj.title) {
              namePath.push(obj.title);
            }
            this.deepProcessKeys(value, keyPath, namePath);
            keyPath.pop();
            if (obj.title) {
              namePath.pop();
            }

          }
        }

        // We've been through all of the keys in this object and we have the signature of a control then add it to the array
        if (!isParent && hasType && hasTitle) {
          this.controls.push({object: obj, keyPath: Array.from(keyPath), namePath: Array.from(namePath), validations: validations});
        }
      }
      return obj;
    },

    generateGuid() {
      let result, i, j;
      result = '';
      for (j = 0; j < 32; j++) {
        if (j === 8 || j === 12 || j === 16 || j === 20)
          result = result + '-';
        i = Math.floor(Math.random()*16).toString(16).toUpperCase();
        result = result + i;
      }
      return result;
    },

    save(activate) {
      if (this.loading) {
        return;
      }
      this.loading = true;
      this.controls.forEach(c => {
        if (!('showIf' in c.object) || ('showIf' in c.object && c.object.showIf() === true)) {
          // Unset the value from the model array
          this.set(c.keyPath.filter(e => e !== 'properties').join('.'), this.processCast(this.get(c.keyPath.filter(e => e !== 'properties').join('.'), this.model), c.object.type), this.finalModel);
        }
      });

      axios.patch(`/api/groups/${this.device.node.group.id}/nodes/${this.device.node}/connections/${this.deviceConnection.id}`, {
        'configuration': JSON.stringify(this.finalModel),
        'device': this.device.id
      }).then(() => {
        this.loading = false;
        this.$emit('close');
        this.requestDataReloadFor('deviceConnections');
        this.requestDataReloadFor('device');
        window.showNotification({
            title: 'Saved',
            description: 'The device connection details have been saved.',
            type: 'success',
        });
      }).catch(error => {
        this.loading = false;
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        this.handleError(error);
      });
    },
  },

  data() {
    return {
      loading: false,
      deviceConnectionLoading: false,
      model: {
        name: '',
        connType: 'OPC UA',
        UDPConnDetails: {
          port: 50205,
        },
        MQTTConnDetails: {
          host: '',
          protocol: 'mqtts',
          port: 8883,
          useSSL: true,
          clientId: this.device.node.group.name + '-' + this.device.node.node_id + '-' + this.device.device_id + '-' + this.generateGuid(),
          username: '',
          password: '',
          cleanSession: true,
          keepAlive: 60,
        },
        OPCUAConnDetails: {
          endpoint: null,
          securityPolicy: 'Basic256',
          securityMode: 'SignAndEncrypt',
          useCredentials: true,
          username: null,
          password: null,
        },
        OpenProtocolConnDetails: {
          host: null,
          port: '4545',
        },
        ASCIITCPConnDetails: {
          ip: null,
          inputs: '4',
          outputs: '4',
        },
        RESTConnDetails: {
          baseURL: '',
          authMethod: 'None',
          username: '',
          password: '',
        },
        MTConnectConnDetails: {
          baseURL: '',
          authMethod: 'None',
          username: '',
          password: '',
        },
        s7ConnDetails: {
          hostname: '',
          port: 102,
          rack: 1,
          slot: 1,
          timeout: 5000,
        },
        pollInt: 1000,
        payloadFormat: 'Defined by Protocol',
        delimiter: ',',
      },
      finalModel: {},
      controls: [],
      schema: {
        'type': 'object',
        'properties': {
          'name': {
            description: 'A local name for this connection.',
            title: 'Connection Name',
            type: 'string',
            validations: {
              required,
              minLength: minLength(3),
            },
          },
          'connType': {
            title: 'Connection Type',
            type: 'string',
            validations: {
              required,
            },
            description: 'The type of connection to the underlying device.',
            enum: [
              'Fieldbus',
              'MQTT',
              'OPC UA',
              'REST',
              'S7',
              'UDP',
              'MTConnect',
              'Open Protocol',
              'ASCII TCP'
            ],
          },
          'UDPConnDetails': {
            type: 'object',
            title: 'UDP Server Details',
            description: 'The connection details to the UDP server.',
            properties: {
              port: {
                description: 'The port number on which the client must connect to the UDP server on.',
                title: 'Port',
                type: 'number',
                showIf: () => {
                  return this.model.connType === 'UDP' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'UDP' || false;
                  }),
                  numeric,
                },
                enum: [
                  50205,
                ],
              },
            },
          },
          'MQTTConnDetails': {
            type: 'object',
            title: 'MQTT Server Details',
            properties: {
              host: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                  minLength: minLength(3),
                },
                description: 'The hostname of the MQTT server to connect to.',
                title: 'Hostname/IP',
              },
              protocol: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                  minLength: minLength(3),
                },
                description: 'The protocol to connect to the MQTT server using.',
                title: 'Protocol',
                enum: [
                  'mqtt',
                  'mqtts',
                  'tcp',
                  'tls',
                  'ws',
                  'wss',
                ],
                default: 'mqtt',
              },
              port: {
                type: 'number',
                description: 'The port number to connect to the MQTT server on.',
                title: 'Port',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                  numeric,
                },
                default: 1883,
              },
              useSSL: {
                type: 'boolean',
                description: 'Should the connection be an encrypted connection using SSL?',
                title: 'Use SSL?',
                format: 'checkbox',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                },
              },
              clientId: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                  minLength: minLength(10),
                },
                description: 'The MQTT client ID for this device.',
                title: 'Client ID',
              },
              username: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  minLength: minLength(3),
                },
                description: 'The username for the MQTT connection.',
                title: 'Username',
              },
              password: {
                type: 'password',
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  minLength: minLength(3),
                },
                description: 'The password for the MQTT connection.',
                title: 'Password',
                format: 'password',
              },
              cleanSession: {
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                },
                type: 'boolean',
                description: 'Should this connection create a clean session?',
                title: 'Clean Session',
                format: 'checkbox',
                default: true,
              },
              keepAlive: {
                showIf: () => {
                  return this.model.connType === 'MQTT' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MQTT' || false;
                  }),
                },
                type: 'number',
                description: 'The keepalive period for this connection.',
                title: 'Keep Alive Interval (sec)',
                default: 60,
              },
            },
          },
          'OpenProtocolConnDetails': {
            type: 'object',
            title: 'Open Protocol Details',
            properties: {
              host: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'Open Protocol' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'Open Protocol' || false;
                  }),
                  minLength: minLength(3),
                },
                description: 'The hostname of the controller to connect to.',
                title: 'Hostname/IP',
              },
              port: {
                type: 'number',
                description: 'The port number to connect to the controller on.',
                title: 'Port',
                showIf: () => {
                  return this.model.connType === 'Open Protocol' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'Open Protocol' || false;
                  }),
                  numeric,
                },
                default: 4545,
              }
            },
          },
          'ASCIITCPConnDetails': {
            type: 'object',
            title: 'ASCII TCP Details',
            properties: {
              ip: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'ASCII TCP' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'ASCII TCP' || false;
                  }),
                  minLength: minLength(3),
                },
                description: 'The IP of the controller to connect to.',
                title: 'IP',
              },
              inputs: {
                type: 'number',
                description: 'The number of inputs to read from the controller.',
                title: 'Inputs',
                showIf: () => {
                  return this.model.connType === 'ASCII TCP' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'ASCII TCP' || false;
                  }),
                  numeric,
                },
                default: 4,
              },
              outputs: {
                type: 'number',
                description: 'The number of outputs to read from the controller.',
                title: 'Outputs',
                showIf: () => {
                  return this.model.connType === 'ASCII TCP' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'ASCII TCP' || false;
                  }),
                  numeric,
                },
                default: 4,
              }

            },
          },
          'OPCUAConnDetails': {
            type: 'object',
            title: 'OPC-UA Server Details',
            properties: {
              endpoint: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'OPC UA' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'OPC UA' || false;
                  }),
                  minLength: minLength(1),
                  opcEndpoint: helpers.withMessage('This does not look like a valid OPC endpoint (opc.tcp://[HOST]:[PORT])', helpers.regex(/^opc\.tcp:\/\/.+:\d+\/?$/)),

                },
                description: 'The endpoint of the OPC UA server.',
                title: 'Endpoint',
              },
              securityPolicy: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'OPC UA' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'OPC UA' || false;
                  }),
                  minLength: minLength(1),
                },
                description: 'The security policy for the OPC UA connection.',
                title: 'Security Policy',
                enum: [
                  'None',
                  'Basic128',
                  'Basic192',
                  'Basic192Rsa15',
                  'Basic256Rsa15',
                  'Basic256Sha256',
                  'Aes128_Sha256',
                  'Aes128_Sha256_RsaOaep',
                  'PubSub_Aes128_CTR',
                  'PubSub_Aes256_CTR',
                  'Basic128Rsa15',
                  'Basic256',
                ],
                default: 'None',
              },
              securityMode: {
                type: 'string',
                showIf: () => {
                  return this.model.connType === 'OPC UA' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'OPC UA' || false;
                  }),
                  minLength: minLength(1),
                },
                description: 'The security mode for the OPC UA connection.',
                title: 'Security Mode',
                enum: [
                  'None',
                  'Sign',
                  'SignAndEncrypt',
                ],
                default: 'None',
              },
              useCredentials: {
                showIf: () => {
                  return this.model.connType === 'OPC UA' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'OPC UA' || false;
                  }),
                },
                description: 'Should the OPC UA connection use credentials?',
                title: 'Use credentials',
                type: 'boolean',
                format: 'checkbox',
                default: true,
              },
              username: {
                showIf: () => {
                  return (this.model.connType === 'OPC UA' && this.model.OPCUAConnDetails.useCredentials === true) || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return (this.model.connType === 'OPC UA' && this.model.OPCUAConnDetails.useCredentials === true) || false;
                  }),
                  minLength: minLength(3),
                },
                description: 'The username for the OPC UA connection.',
                title: 'Username',
                type: 'string',
              },
              password: {
                type: 'password',
                showIf: () => {
                  return (this.model.connType === 'OPC UA' && this.model.OPCUAConnDetails.useCredentials === true) || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return (this.model.connType === 'OPC UA' && this.model.OPCUAConnDetails.useCredentials === true) || false;
                  }),
                  minLength: minLength(3),
                },
                description: 'The password for the OPC UA connection.',
                title: 'Password',
                format: 'password',
              },
            },
          },
          'RESTConnDetails': {
            type: 'object',
            title: 'REST Connection Details',
            properties: {
              baseURL: {
                type: 'string',
                description: 'The base URL for the REST connection.',
                title: 'Base URL',
                showIf: () => {
                  return this.model.connType === 'REST' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'REST' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              authMethod: {
                type: 'string',
                description: 'Does the connection employ an authentication method?',
                title: 'Authentication Method',
                enum: [
                  'None',
                  'Basic',
                ],
                default: 'None',
                showIf: () => {
                  return this.model.connType === 'REST' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'REST' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              username: {
                type: 'string',
                description: 'The username for the REST authentication.',
                title: 'Username',
                showIf: () => {
                  return (this.model.connType === 'REST' && this.model.RESTConnDetails.authMethod === 'Basic') || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return (this.model.connType === 'REST' && this.model.RESTConnDetails.authMethod === 'Basic') || false;
                  }),
                  minLength: minLength(1),
                },
              },
              password: {
                type: 'password',
                description: 'The password for the REST authentication.',
                title: 'Password',
                showIf: () => {
                  return (this.model.connType === 'REST' && this.model.RESTConnDetails.authMethod === 'Basic') || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return (this.model.connType === 'REST' && this.model.RESTConnDetails.authMethod === 'Basic') || false;
                  }),
                  minLength: minLength(1),
                },
              },
            },
          },
          'MTConnectConnDetails': {
            type: 'object',
            title: 'MTConnect Connection Details',
            properties: {
              baseURL: {
                type: 'string',
                description: 'The base MTConnect URL.',
                title: 'Base URL',
                showIf: () => {
                  return this.model.connType === 'MTConnect' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MTConnect' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              authMethod: {
                type: 'string',
                description: 'Does the connection employ an authentication method?',
                title: 'Authentication Method',
                enum: [
                  'None',
                  'Basic',
                ],
                default: 'None',
                showIf: () => {
                  return this.model.connType === 'MTConnect' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'MTConnect' || false;
                  }),
                  minLength: minLength(3),
                },
              },
              username: {
                type: 'string',
                description: 'The username for the MTConnect authentication.',
                title: 'Username',
                showIf: () => {
                  return (this.model.connType === 'REST' && this.model.MTConnectConnDetails.authMethod === 'Basic') || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return (this.model.connType === 'REST' && this.model.MTConnectConnDetails.authMethod === 'Basic') || false;
                  }),
                  minLength: minLength(1),
                },
              },
              password: {
                type: 'password',
                description: 'The password for the MTConnect authentication.',
                title: 'Password',
                showIf: () => {
                  return (this.model.connType === 'REST' && this.model.MTConnectConnDetails.authMethod === 'Basic') || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return (this.model.connType === 'REST' && this.model.MTConnectConnDetails.authMethod === 'Basic') || false;
                  }),
                  minLength: minLength(1),
                },
              },
            },
          },
          's7ConnDetails': {
            type: 'object',
            title: 'S7 Connection Details',
            properties: {
              hostname: {
                type: 'string',
                description: 'The hostname or IP address of the PLC.',
                title: 'Hostname/IP Address',
                showIf: () => {
                  return this.model.connType === 'S7' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'S7' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              port: {
                type: 'number',
                description: 'The port on which to connect to the PLC.',
                title: 'Port',
                default: 102,
                showIf: () => {
                  return this.model.connType === 'S7' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'S7' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              rack: {
                type: 'number',
                description: 'The rack number of the PLC.',
                title: 'Rack',
                showIf: () => {
                  return this.model.connType === 'S7' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'S7' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              slot: {
                type: 'number',
                description: 'The slot number of the PLC.',
                title: 'Slot',
                showIf: () => {
                  return this.model.connType === 'S7' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'S7' || false;
                  }),
                  minLength: minLength(1),
                },
              },
              timeout: {
                type: 'number',
                description: 'The connection timeout.',
                title: 'Timeout',
                default: 5000,
                showIf: () => {
                  return this.model.connType === 'S7' || false;
                },
                validations: {
                  requiredIf: requiredIf(() => {
                    return this.model.connType === 'S7' || false;
                  }),
                  minLength: minLength(1),
                },
              },
            },
          },
          'pollInt': {
            type: 'number',
            description: 'The polling interval of the connection.',
            title: 'Polling Interval (ms)',
            default: 1000,
            validations: {
              required,
              numeric,
              minLength: minLength(1),
            },
          },
          'payloadFormat': {
            description: 'Override the payload format of this connection.',
            title: 'Payload Format',
            type: 'string',
            enum: [
              'Defined by Protocol',
              'Delimited String',
              'JSON',
              'XML',
              'Buffer',
            ],
            default: 'Define by Protocol',
            showIf: () => {
              return ['REST', 'UDP', 'MQTT'].includes(this.model.connType) || false;
            },
            validations: {
              required,
              minLength: minLength(1),
            },
          },
          'delimiter': {
            description: 'The delimiter for the payload.',
            title: 'Delimiter',
            type: 'string',
            showIf: () => {
              return this.model.payloadFormat === 'Delimited String' || false;
            },
            validations: {
              requiredIf: requiredIf(() => {
                return (['REST', 'UDP', 'MQTT'].includes(this.model.connType) && this.model.payloadFormat === 'Delimited String') || false;
              }),
              minLength: minLength(1),
              maxLength: maxLength(1),
            },
          },
        },
      },
    };
  },
  validations() {
    let returnObj = {
      model: {},
    };

    // Build up validation array for current step by going through the controls array and creating a validation entry for its model path
    for (const [key, control] of Object.entries(this.controls)) {
      // Only validate if the control is visible
      if (!('showIf' in control.object) || ('showIf' in control.object && control.object.showIf() === true)) {
        this.set(control.keyPath.filter(e => e !== 'properties').join('.'), control.validations, returnObj.model);
      }
    }
    return returnObj;
  },
};
</script>


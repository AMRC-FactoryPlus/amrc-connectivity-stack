<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col px-10 py-6 items-center flex-grow">
    <div class="flex flex-col items-center gap-6">
      <form-control-input :key="'deviceId'" :control="deviceIdControl"
        :valid="v$.deviceId" :value="deviceId" @valueUpdated="deviceIdUpdated"/>
      <div class="w-full">
        <form-control-input :key="'pubInterval'" :control="pubIntervalControl"
          :valid="v$.pubInterval" :value="pubInterval"
          @valueUpdated="pubIntervalUpdated"/>
      </div>
      <div class="w-full">
        <form-control-input :key="'deviceUUID'" :control="deviceUUIDControl" :valid="{}" :value="device?.instance_uuid"/>
      </div>
    </div>
    <button @mouseup="updateDeviceInfo" 
      :disabled="loading || (v$ && (!v$.$anyDirty || v$.$invalid))"
      class="fpl-button-brand h-10 ml-auto w-32 mt-6">
      <div v-if="loading === false" class="text-base mr-3 ml-10 flex items-center justify-center">
        Save
        <i class="fa-sharp fa-solid fa-save ml-2"></i>
      </div>
      <i v-if="loading === false" class="mr-10"></i>
      <div v-else class="w-12">
        <i class="fa-sharp fa-solid fa-circle-notch fa-spin"></i>
      </div>
    </button>
  </div>
</template>

<script>
import { required, minLength, helpers } from '@vuelidate/validators';
import useVuelidate from '@vuelidate/core';

export default {
  setup () {
    return { v$: useVuelidate() }
  },
  name: 'DeviceEditorInformationTab',

  components: {
    'form-control-input': () => import(/* webpackPrefetch: true */ '../FormControls/Input.vue'),
  },

  props: {
    device: {required: true},
  },

  watch: {
    device: {
      handler (val) {
        this.deviceIdControl.value = val.device_id;
        this.deviceId = val.device_id;
        const pubInt = val.pub_interval.toString();
        this.pubIntervalControl.value = pubInt;
        this.pubInterval = pubInt;
      }, deep: true,
    },
  },

  methods: {
    deviceIdUpdated(val) {
      this.deviceId = val;
      this.v$.deviceId.$touch();
    },
    pubIntervalUpdated (val) {
      this.pubInterval = val;
      this.v$.pubInterval.$touch();
    },

    updateDeviceInfo() {
      if (this.loading) {
        return;
      }
      this.loading = true;
      axios.patch(`/api/devices/${this.device.id}`, {
        'device_id': this.deviceId,
        /* The vuelidation should not allow this to fail */
        'pub_interval': Number.parseInt(this.pubInterval),
      }).then(() => {
        this.loading = false;
        this.requestDataReloadFor('device');
        window.showNotification({
          title: 'Saved',
          description: 'The device details have been saved.',
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

  validations () {
    return {
      deviceId: {
        required,
        minLength: minLength(3),
        deviceNameValid: helpers.withMessage('The device name does not conform to the Factory+ specification.', helpers.regex(/^\w+?$/i)),
      },
      pubInterval: {
        required,
        unsignedInt: helpers.withMessage(
          "An integer is required", helpers.regex(/^[0-9]+$/)),
      },
    };
  },

  data () {
    return {
      loading: false,
      deviceId: this.device ? this.device.device_id : 'Device',
      deviceUUID: this.device ? this.device.instance_uuid : 'Not yet assigned',
      pubInterval: this.device?.pub_interval?.toString() ?? "0",
      deviceIdControl: {
        name: 'Device Name',
        description: 'Device names must comply with the naming convention outlined in the Factory+ specification.',
        placeholder: 'e.g. KUKA_KR360_5345243',
        infoLink: 'https://factoryplus.app.amrc.co.uk/core-framework/framework/messages-payload/framework-protocol#topic-structure',
        infoTooltip: 'Read naming convention',
        type: 'input',
        validations: {},
        initialValue: '',
        value: '',
      },
      pubIntervalControl: {
        name: 'Publish interval',
        description: 'Set to 0 to publish all received data immediately.',
        type: 'input',
        validations: {},
        initialValue: '',
        value: '',
      },
      deviceUUIDControl: {
        name: 'Instance UUID',
        description: 'The Instance UUID that was assigned to the device when it first published a valid configuration. ',
        placeholder: 'Not yet assigned',
        infoLink: 'https://factoryplus.app.amrc.co.uk/consumption-framework/services/directory#instance-uuids',
        infoTooltip: 'Instance UUID documentation',
        type: 'input',
        disabled: true,
        validations: {},
        initialValue: '',
        value: '',
      },
    };
  },
};
</script>


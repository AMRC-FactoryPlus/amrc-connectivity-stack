<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="grid grid-cols-3 gap-10 flex-grow">
    <div v-if="showDescription" class="col-span-1 text-sm text-gray-400 my-auto mt-7">
      {{control.description}}
    </div>
    <div class="flex flex-col" :class="[showDescription ? 'col-span-2' : 'col-span-3']">
      <div class="flex items-center mb-2">
        <h4 v-if="control.name">{{control.name}}</h4>
        <button v-if="control.infoLink" @mouseup="goto_url_tab(control.infoLink)"
                v-tooltip="control.infoTooltip"
                class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></button>
        <i v-else-if="control.infoTooltip"
           v-tooltip="control.infoTooltip" class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></i>
      </div>
      <div class="flex w-full relative">
        <input v-if="control.prefix" disabled v-model="control.prefix" class="fpl-input w-24 text-gray-700 text-right">
        <input @blur="encrypt" :disabled="control.disabled || encrypting || hasEncryptedData"
               v-if="password"
               type="password"
               v-model="localValue"
               :placeholder="control.placeholder"
               class="fpl-input flex-grow text-gray-700"
               :class="(valid.$invalid) ? 'ring-2 ring-offset-2 ring-opacity-30 ring-red-500' :''">
        <input v-else v-on:keyup.enter="$emit('keyUpEnter')" :disabled="control.disabled"
               type="text"
               v-model="localValue"
               :placeholder="control.placeholder"
               class="fpl-input flex-grow text-gray-700"
               :class="(valid.$invalid) ? 'ring-2 ring-offset-2 ring-opacity-30 ring-red-500' :''">
        <div class="absolute right-0 top-0 bottom-0 flex items-center justify-center pr-3">
          <div v-tooltip="valid.$silentErrors?.length > 0 ? (valid.$silentErrors[0].$message) : null"
               class="mr-auto px-2 py-1 bg-red-200 text-red-500 text-xs cursor-default"
               v-if="valid.$invalid">INVALID
          </div>
          <slot name="info"></slot>
        </div>
        <div class="absolute right-0 top-0 bottom-0 flex items-center justify-center pr-3">
          <button @click="changeSecureInformation" v-if="password"
                  v-tooltip="`Data entered into this field is encrypted and secure`"
                  class="mr-auto px-2 py-1 bg-green-200 hover:bg-green-300 hover:cursor-pointer text-green-800 text-xs cursor-default flex items-center justify-center gap-1">
            <div v-if="encrypting" class="flex items-center justify-center gap-1.5 animate-pulse">
              <i class="fa-solid fa-circle-notch animate-spin"></i>
              <div>ENCRYPTING</div>
            </div>
            <div v-else class="flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-edit"></i>
              <div>CHANGE SECURE INFORMATION</div>
            </div>
          </button>
          <slot name="info"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Input',
  props: {
    control: {},
    valid: {},
    value: {},
    showDescription: {
      type: Boolean,
      default: true,
    },
    password: {
      required: false,
      type: Boolean,
      default: false,
    },

    device: {
      required: false,
      type: String,
      default: null,
    },
  },

  watch: {
    value (val) {
      this.localValue = val
    },
    localValue (val) {
      this.$emit('valueUpdated', val)
      this.$emit('input', val)
    },
  },

  computed: {
    hasEncryptedData () {
      // A field has encrypted data if it has a value and the value starts with __FPSI__
      return this.localValue && this.localValue.startsWith('__FPSI__')
    },
  },

  methods: {

    changeSecureInformation () {
      window.showNotification({
        title: 'Change Secure Information',
        description: 'Are you sure? This will immediately and irreversibly remove the current secure information associated with this field. This action cannot be undone.',
        type: 'error',
        buttons: [
          {
            text: 'Delete and Change', type: 'error', loadingOnClick: true, action: () => {
              this.localValue = null
              window.hideNotification({ id: 'f8d4f892-71c1-4498-ae15-32526408f9e5' })
            },
          },
          { text: 'Cancel', isClose: true },
        ],
        id: 'f8d4f892-71c1-4498-ae15-32526408f9e5',
      })
    },

    encrypt (value) {

      if (this.encrypting) {
        return
      }

      if (this.localValue === null || this.localValue.length === 0) {
        this.localValue = null
        return;
      }

      if (!this.device) {
        window.showNotification({
          title: 'Unable to encrypt',
          description: 'An associated device is required to encrypt sensitive information. Please contact your administrator.',
          type: 'error',
          id: '19bb6eb4-155c-4aba-9e94-d8efe1cb6b51',
        })
        return
      }

      // Generate a tag for the sensitive information that can be used to retrieve it later
      this.encrypting = true
      axios.post('/api/sensitive-information', {
        device: this.device,
        value: this.localValue,
      }).then(response => {
        this.localValue = response.data.data
        this.encrypting = false
      }).catch(error => {
        this.handleError(error)
        this.encrypting = false
      })
    },
  },

  data () {
    return {
      localValue: this.value,
      encrypting: false,
    }
  },
}
</script>

<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps({
  defaultValue: {
    type: [String, Number],
    required: false,
  },
  modelValue: {
    type: [String, Number],
    required: false,
  },
  class: {
    type: null,
    required: false,
  },
  v: {
    type: Object,
    required: false,
  },
  title: {
    type: String,
    required: false,
  },
  placeholder: {
    type: String,
    required: false,
  },
  type: {
    type: String,
    required: false,
    default: 'text',
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  icon: {
    type: String,
    required: false,
  },
  onEncrypt: {
    type: Function,
    required: false,
    default: null
  }
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <div class="relative flex-1">
    <div class="relative">
      <!-- Icon on the left if provided -->
      <div v-if="icon" class="absolute left-0 top-0 bottom-0 flex items-center pl-3 pointer-events-none">
        <i :class="`fa-fw fa-solid fa-${icon} text-gray-400 text-sm`"></i>
      </div>
      <input
        :type="inputType"
        :value="displayValue"
        @input="handleInput"
        @blur="handleBlur"
        :disabled="disabled || isEncrypting"
        :placeholder="placeholder"
        :min="min"
        :max="max"
        :step="step"
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        :class="[
          { 'border-red-500': v?.$error, 'pl-[2.1rem]': icon },
          className
        ]"
      />
    </div>

    <!-- Only show encrypting status -->
    <div v-if="type === 'password' && isEncrypting" class="absolute right-0 top-0 bottom-0 flex items-center pr-2">
      <div class="px-2 py-1 bg-green-200 rounded text-green-800 text-xs flex items-center gap-1.5 animate-pulse">
        <i class="fa-solid fa-circle-notch animate-spin"></i>
        <span>ENCRYPTING</span>
      </div>
    </div>
  </div>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import {UUIDs} from "@amrc-factoryplus/service-client";

export default {
  name: 'Input',

  props: {
    type: {
      type: String,
      default: 'text'
    },
    modelValue: {
      type: [String, Number],
      default: ''
    },
    placeholder: String,
    disabled: Boolean,
    className: String,
    v: Object,
    min: [String, Number],
    max: [String, Number],
    step: [String, Number],
    icon: String,
    onEncrypt: {
      type: Function,
      required: false,
      default: null
    }
  },

  setup() {
    return {
      s: useServiceClientStore(),
    }
  },

  data() {
    return {
      isEncrypting: false,
      localValue: this.modelValue
    }
  },

  computed: {
    inputType() {
      return this.type
    },

    isEncrypted() {
      return typeof this.localValue === 'string' && this.localValue.startsWith('__FPSI__')
    },

    displayValue() {
      // For encrypted passwords, show placeholder text instead of the actual encrypted value
      if (this.type === 'password' && this.isEncrypted) {
        return '••••••••'
      }
      return this.localValue
    }
  },

  watch: {
    modelValue(newValue) {
      if (newValue !== this.localValue) {
        this.localValue = newValue
      }
    }
  },

  methods: {
    handleInput(event) {
      const value = event.target.value
      this.updateValue(value)
    },

    async handleBlur(event) {
      const value = event.target.value

      // Handle password field encryption
      if (this.type === 'password' && value && value !== '••••••••') {
        try {
          this.isEncrypting = true

          if (!this.onEncrypt) {
            throw new Error('Encryption handler not provided')
          }

          const encryptedKey = await this.onEncrypt(value)
          this.updateValue(encryptedKey)
        } catch (error) {
          console.error('Failed to encrypt sensitive information:', error)
          this.$emit('error', 'Failed to encrypt sensitive information')
        } finally {
          this.isEncrypting = false
        }
        return
      }

      // Normal field blur
      this.$emit('blur', event)
    },

    updateValue(value) {
      // Convert to number if type is number
      if (this.type === 'number' && value !== '') {
        value = Number(value)
      }

      this.localValue = value
      this.$emit('update:modelValue', value)
    }
  }
}
</script>

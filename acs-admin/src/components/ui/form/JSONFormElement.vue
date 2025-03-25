<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col gap-1" v-if="isVisible">
    <label v-if="element.type !== 'boolean'" class="text-sm font-medium" :for="element.title">{{ element.title }}</label>

    <!-- Text/Number Input (only if no enum) -->
    <template v-if="(element.type === 'string' || element.type === 'number') && !element.enum">
      <Input 
        :id="element.title"
        :type="element.format === 'password' ? 'password' : element.type === 'number' ? 'number' : 'text'"
        :placeholder="element.options?.inputAttributes?.placeholder"
        :value="localValue"
        @update:modelValue="updateValue"
        :v="v$"
        :class="{ 'border-red-500': v$.localValue.$error }"
        :min="element.type === 'number' ? element.minimum : undefined"
        :max="element.type === 'number' ? element.maximum : undefined"
        :step="element.type === 'number' ? element.multipleOf || 1 : undefined"
        :onEncrypt="onEncrypt"
      />
    </template>

    <!-- Enum/Select -->
    <template v-if="element.enum">
      <Select 
        :id="element.title"
        :value="localValue"
        @update:modelValue="updateValue"
      >
        <SelectTrigger>
          <SelectValue :placeholder="element.title">
            {{ localValue }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem 
              v-for="option in element.enum" 
              :key="option" 
              :value="option"
            >
              {{ option }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </template>

    <!-- Boolean/Checkbox -->
    <template v-if="element.type === 'boolean'">
      <div class="flex items-center space-x-2">
        <Checkbox 
          :id="element.title"
          :checked="localValue"
          @update:modelValue="updateValue"
        />
        <label :for="element.title" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {{ element.title }}
        </label>
      </div>
    </template>

    <p v-if="element.description" class="text-sm text-gray-500">
      {{ element.description }}
    </p>
  </div>
</template>

<script>
import { useVuelidate } from '@vuelidate/core'
import { required, minLength, helpers } from '@vuelidate/validators'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

export default {
  name: 'JSONFormElement',

  components: {
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Checkbox
  },

  setup() {
    return {
      v$: useVuelidate()
    }
  },

  props: {
    element: {
      type: Object,
      required: true
    },
    modelValue: {
      type: [String, Number, Boolean],
      default: ''
    },
    formData: {
      type: Object,
      required: true
    },
    onEncrypt: {
      type: Function,
      required: false,
      default: null
    }
  },

  emits: ['update:modelValue', 'change'],

  computed: {
    isVisible() {
      const dependencies = this.element.options?.dependencies
      if (!dependencies) return true

      return Object.entries(dependencies).every(([field, requiredValue]) => {
        const currentValue = this.formData[field]
        return currentValue === requiredValue
      })
    },
  },

  methods: {
    updateValue(newValue) {
      this.v$.localValue.$model = newValue
      this.$emit('update:modelValue', newValue)
      this.$emit('change', {
        field: this.element.key,
        value: newValue,
        valid: !this.v$.localValue.$error
      })
    }
  },

  watch: {
    modelValue: {
      handler(newValue) {
        if (this.v$.localValue.$model !== newValue) {
          this.v$.localValue.$model = newValue
        }
      }
    },
    isVisible: {
      handler(newVisible) {
        if (!newVisible && this.v$.localValue.$model !== '') {
          this.v$.localValue.$model = ''
          this.v$.$reset()
          this.$emit('update:modelValue', '')
          this.$emit('change', {
            field: this.element.key,
            value: '',
            valid: true
          })
        }
      }
    }
  },

  data() {
    return {
      localValue: this.modelValue,
    }
  },

  validations() {
    const validations = {}

    if (this.element.required) {
      validations.required = required
    }

    if (this.element.minLength) {
      validations.minLength = minLength(this.element.minLength)
    }

    if (this.element.pattern) {
      // Create a RegExp object from the pattern string
      validations.pattern = helpers.regex(new RegExp(this.element.pattern))
      if (this.element.options?.patternmessage) {
        validations.pattern = helpers.withMessage(
          this.element.options.patternmessage,
          validations.pattern
        )
      }
    }

    return {
      localValue: validations
    }
  },
}
</script>
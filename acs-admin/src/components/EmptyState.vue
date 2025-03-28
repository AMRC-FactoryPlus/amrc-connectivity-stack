<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col items-center justify-center p-10 space-y-8 h-full max-w-xl mx-auto">
    <div class="text-center flex flex-col gap-2">
      <i v-if="icon" :class="`fa-solid fa-${icon} fa-2x mb-3`"></i>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-50">{{ title }}</h3>
      <p class="text-gray-500 dark:text-gray-400">{{ description }}</p>
    </div>
    <Button v-if="buttonText" variant="default" @click="handleButtonClick">
      <i v-if="buttonIcon" :class="`fa-solid fa-${buttonIcon} mr-2`"></i>
      {{ buttonText }}
    </Button>
    <slot name="actions"></slot>
  </div>
</template>

<script>
import { Button } from '@/components/ui/button'

export default {
  name: 'EmptyState',
  
  components: {
    Button
  },

  props: {
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    buttonText: {
      type: String,
      default: null
    },
    buttonIcon: {
      type: String,
      default: null
    },
    icon: {
      type: String,
      default: null
    }
  },

  methods: {
    handleButtonClick() {
      this.$emit('button-click')
    }
  }
}
</script>
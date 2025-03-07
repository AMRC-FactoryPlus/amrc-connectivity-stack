<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="hover:underline hover:cursor-pointer flex items-center gap-2 group" @click="copy">
    <slot/>
    <i class="fa-solid text-xl fa-copy !hidden group-hover:!inline"></i>
  </div>
  <div v-if="copied" class="text-xs text-green-700">
    Copied!
  </div>
  <div v-else class="text-xs text-muted-foreground">
    Click to copy
  </div>
</template>

<script>
import { useClipboard } from '@vueuse/core'

export default {

  name: 'Copyable',

  setup () {
    return {}
  },

  props: {
    text: {
      type: String,
      required: true,
    },
  },

  methods: {
    copy () {
      const { copy } = useClipboard()
      copy(this.text)
      this.copied = true
    },
  },

  data () {
    return {
      copied: false,
    }
  },
}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div title="Click to copy" class="hover:underline hover:cursor-pointer flex items-center gap-2 group" @click="copy">
    <slot/>
    <i class="fa-solid text-xl fa-copy !hidden group-hover:!inline"></i>
  </div>
</template>

<script>
import { useClipboard } from '@vueuse/core'
import { toast } from 'vue-sonner'

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
      toast.success('Text copied to clipboard')
    },
  },

  data () {
    return {
      copied: false,
    }
  },
}
</script>
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The escape hatch.
  -
  - Editing here is safe because the document model is lossless: anything
  - the composer cannot express parses to an opaque node and round-trips
  - untouched. The classifier treats any change to such a node as
  - breaking, so a raw edit can never quietly update a schema in place.
  -->

<template>
  <Dialog :open="open" @update:open="close">
    <DialogContent class="sm:max-w-[820px] max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Raw schema</DialogTitle>
        <DialogDescription>
          The JSON Schema this composes to. Editing it replaces the whole
          document.
        </DialogDescription>
      </DialogHeader>

      <textarea
          v-model="text"
          spellcheck="false"
          class="flex-1 min-h-[420px] font-mono text-xs border rounded-md p-3
                 focus:outline-none focus:ring-1 focus:ring-gray-400"></textarea>

      <p v-if="error" class="text-xs text-red-500">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close(false)">Cancel</Button>
        <Button :disabled="!changed" @click="apply">Apply</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Button } from '@components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@components/ui/dialog'

export default {
  name: 'RawSchemaDialog',

  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
  },

  props: {
    open: { type: Boolean, default: false },
    body: { type: Object, default: () => ({}) },
  },

  emits: ['update:open', 'apply'],

  data () {
    return {
      text: '',
      original: '',
      error: null,
    }
  },

  computed: {
    changed () {
      return this.text !== this.original
    },
  },

  watch: {
    open (value) {
      if (!value) return
      this.original = JSON.stringify(this.body, null, 2)
      this.text = this.original
      this.error = null
    },
  },

  methods: {
    close (value) {
      this.$emit('update:open', value === true)
    },

    apply () {
      let parsed
      try {
        parsed = JSON.parse(this.text)
      } catch (e) {
        this.error = `That is not valid JSON: ${e.message}`
        return
      }

      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.error = 'A schema must be a JSON object.'
        return
      }

      this.error = null
      this.$emit('apply', parsed)
      this.close(false)
    },
  },
}
</script>

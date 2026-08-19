<template>
  <Dialog :open="open" @update:open="v => !v && $emit('close')">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Upload cassette</DialogTitle>
        <DialogDescription>
          A cassette is a JSON recording of one machine job. It is stored
          on the platform and can be loaded into any deck.
        </DialogDescription>
      </DialogHeader>

      <div
        class="flex flex-col items-center gap-2.5 rounded-lg border border-dashed p-8 text-center transition-colors"
        :class="dragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-gray-50'"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <template v-if="!doc">
          <i class="fa-solid fa-file-arrow-up text-2xl text-gray-400"></i>
          <div class="text-sm font-medium">Drop a .json recording here</div>
          <div class="text-xs text-gray-500">
            Up to 64 MB. Channels and duration are read from the file.
          </div>
          <Button size="sm" variant="outline" class="mt-1" @click="$refs.file.click()">
            Choose file
          </Button>
          <input ref="file" type="file" accept=".json,application/json" class="hidden"
            @change="onPick">
        </template>
        <template v-else>
          <i class="fa-solid fa-file-circle-check text-2xl text-green-600"></i>
          <div class="font-mono text-sm font-medium">{{ doc.cassette.name }}</div>
          <div class="text-xs text-gray-500">
            {{ mmss(doc.cassette.duration_ms) }} &middot;
            {{ doc.channels.length }} channels &middot;
            {{ doc.cassette.source ?? 'unknown' }}
          </div>
          <Button size="xs" variant="ghost" @click="reset">Choose a different file</Button>
        </template>
      </div>

      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium">Description</label>
        <input v-model="description"
          class="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
          placeholder="e.g. Roughing pass with a coolant fault at 01:40">
      </div>

      <DialogFooter>
        <Button variant="outline" @click="$emit('close')">Cancel</Button>
        <Button :disabled="!doc || uploading" @click="upload">
          <i v-if="uploading" class="fa-solid fa-circle-notch animate-spin mr-1.5"></i>
          Upload
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { toast } from 'vue-sonner'
import { Button } from '@components/ui/button/index.js'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@components/ui/dialog/index.js'
import { useCassetteMetaStore } from '@store/useCassetteStore.js'
import { mmss } from '@/composables/useCassetteDecks.js'

const MAX_BYTES = 64 * 1024 * 1024

export default {
  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
  },
  props: {
    open: { type: Boolean, required: true },
  },
  emits: ['close', 'uploaded'],
  data () {
    return {
      doc: null,
      description: '',
      error: null,
      dragOver: false,
      uploading: false,
    }
  },
  methods: {
    mmss,
    reset () {
      this.doc = null
      this.error = null
    },
    onDrop (e) {
      this.dragOver = false
      const file = e.dataTransfer?.files?.[0]
      if (file) this.readFile(file)
    },
    onPick (e) {
      const file = e.target.files?.[0]
      if (file) this.readFile(file)
      e.target.value = ''
    },
    async readFile (file) {
      this.error = null
      this.doc = null
      if (file.size > MAX_BYTES) {
        this.error = 'That file is larger than 64 MB.'
        return
      }
      let doc
      try {
        doc = JSON.parse(await file.text())
      }
      catch {
        this.error = 'That file is not valid JSON.'
        return
      }
      const problem = this.validate(doc)
      if (problem) {
        this.error = problem
        return
      }
      doc.cassette.duration_ms ??= doc.samples.at(-1)?.[0] ?? 0
      this.doc = doc
    },
    /* Mirrors the driver's own validation closely enough to catch a
     * bad file before it is stored. The driver revalidates on load. */
    validate (doc) {
      if (typeof doc?.cassette !== 'object') return 'The file has no "cassette" metadata block.'
      if (doc.cassette.version !== 1) return `Unsupported cassette version: ${doc.cassette.version}.`
      if (!doc.cassette.name) return 'The cassette has no name.'
      if (!Array.isArray(doc.channels) || !doc.channels.length) return 'The cassette has no channels.'
      if (!Array.isArray(doc.samples)) return 'The cassette has no samples.'
      let last = -1
      for (const s of doc.samples) {
        if (!Array.isArray(s) || s.length !== 3) return 'A sample is not an [offset, channel, value] triple.'
        if (s[0] < last) return 'Samples are not sorted by offset.'
        last = s[0]
      }
      return null
    },
    async upload () {
      this.uploading = true
      try {
        const uuid = await useCassetteMetaStore().upload(this.doc, this.description.trim())
        toast.success(`Cassette "${this.doc.cassette.name}" stored`)
        this.$emit('uploaded', uuid)
        this.reset()
        this.description = ''
        this.$emit('close')
      }
      catch (err) {
        console.error(err)
        this.error = err?.status === 413
          ? 'The platform refused the file: it is larger than the ConfigDB accepts (raise configdb.bodyLimit).'
          : 'Upload failed. See the console for detail.'
      }
      finally {
        this.uploading = false
      }
    },
  },
}
</script>

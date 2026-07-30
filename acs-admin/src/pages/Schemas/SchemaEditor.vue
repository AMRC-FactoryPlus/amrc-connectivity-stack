<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <Skeleton v-if="loading" class="h-full rounded-lg m-3"/>

    <div v-else-if="loadError"
        class="flex flex-col items-center justify-center flex-1 gap-3 p-10">
      <i class="fa-solid fa-triangle-exclamation fa-2x text-amber-500"></i>
      <p class="text-sm text-gray-600">{{ loadError }}</p>
      <Button variant="outline" @click="$router.push('/schemas')">
        Back to schemas
      </Button>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center gap-3 px-4 py-3 border-b">
        <Button variant="ghost" size="icon" title="Back"
            @click="leave">
          <i class="fa-solid fa-arrow-left"></i>
        </Button>

        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-2">
            <input v-model="name" :disabled="readonly"
                class="font-semibold text-lg bg-transparent border-b border-transparent
                       hover:border-gray-200 focus:border-gray-400 focus:outline-none"/>
            <span v-if="readonly"
                class="text-xs rounded bg-slate-100 text-slate-700 px-1.5 py-0.5">
              AMRC library
            </span>
            <span v-else-if="isDraft"
                class="text-xs rounded bg-blue-100 text-blue-800 px-1.5 py-0.5">
              Draft
            </span>
            <span v-else class="text-xs rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
              v{{ version }}
            </span>
          </div>
          <p v-if="readonly" class="text-xs text-gray-500">
            This schema comes from the AMRC library. Editing creates a local copy.
          </p>
        </div>

        <div class="flex items-center gap-2 ml-auto">
          <Button variant="ghost" @click="rawOpen = true">
            <i class="fa-solid fa-code mr-2"></i>Raw
          </Button>
          <Button v-if="readonly" @click="fork">
            <i class="fa-solid fa-code-fork mr-2"></i>Make a local copy
          </Button>
          <template v-else>
            <Button variant="outline" :disabled="saving || !dirty" @click="save">
              <i v-if="saving" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
              Save
            </Button>
            <Button @click="openPublish">
              <i class="fa-solid fa-upload mr-2"></i>Publish
            </Button>
          </template>
        </div>
      </div>

      <!-- Body -->
      <div class="flex flex-1 min-h-0">
        <div class="w-[26rem] border-r flex flex-col min-h-0">
          <div class="flex-1 overflow-y-auto p-3">
            <StructureTree
                :nodes="doc.children"
                :selected-id="selectedId"
                :readonly="readonly"
                :schema-names="schemaNames"
                @select="select"
                @remove="remove"
                @move="move"/>
          </div>

          <div v-if="!readonly" class="border-t p-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" @click="addMetric">
              <i class="fa-solid fa-gauge mr-2"></i>Metric
            </Button>
            <Button size="sm" variant="outline" @click="openPicker">
              <i class="fa-solid fa-cube mr-2"></i>Component
            </Button>
            <Button size="sm" variant="outline" @click="addGroup">
              <i class="fa-solid fa-folder mr-2"></i>Group
            </Button>
          </div>
          <p v-if="!readonly" class="px-3 pb-3 text-xs text-gray-400">
            Adding into {{ targetLabel }}.
          </p>
        </div>

        <div class="flex-1 overflow-y-auto p-6">
          <template v-if="selectedNode">
            <MetricPanel v-if="selectedNode.kind === 'metric'"
                :node="selectedNode" :readonly="readonly" :key-error="keyError"
                @rename="rename" @change="touch"/>
            <ComponentPanel v-else-if="isComponentKind(selectedNode.kind)"
                :node="selectedNode" :readonly="readonly" :key-error="keyError"
                :schema-names="schemaNames" :published-uuids="publishedUuids"
                @rename="rename" @change="touch" @pick="openReplacePicker"/>
            <GroupPanel v-else-if="selectedNode.kind === 'group'"
                :node="selectedNode" :readonly="readonly" :key-error="keyError"
                @rename="rename"/>
            <div v-else class="max-w-2xl flex flex-col gap-3">
              <div class="text-sm font-medium">{{ selectedNode.key }}</div>
              <p class="text-sm text-gray-500">
                {{ selectedNode.kind === 'reserved'
                  ? 'Set by Factory+ and not editable.'
                  : 'This part of the schema is kept exactly as it is. Use the raw view to see it.' }}
              </p>
              <pre class="bg-gray-50 border rounded-md p-3 text-xs overflow-x-auto">{{
                JSON.stringify(selectedNode.raw, null, 2)
              }}</pre>
            </div>
          </template>

          <div v-else class="flex items-center justify-center h-full">
            <div class="text-center">
              <i class="fa-solid fa-gauge fa-2x text-gray-300"></i>
              <h3 class="mt-3 text-sm font-medium text-gray-700">Nothing selected</h3>
              <p class="mt-1 text-sm text-gray-400">
                Pick something on the left to edit it.
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <ComponentPickerDialog
        v-model:open="pickerOpen"
        :candidates="componentCandidates"
        :is-replacing="!!replacingId"
        @choose="chooseComponent"/>

    <RawSchemaDialog
        v-model:open="rawOpen"
        :body="rawBody"
        @apply="applyRaw"/>

    <PublishDialog
        v-model:open="publishOpen"
        :name="name"
        :version="version"
        :based-on="basedOn"
        :changes="classification.changes"
        :breaking="classification.breaking"
        :configured="reach.configured"
        :publishing="reach.publishing"
        :referenced-by="reach.referencedBy"
        :unresolved="unresolved"
        :schema-names="schemaNames"
        :working="publishing"
        @confirm="publish"/>
  </div>
</template>

<script>
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { v4 as uuidv4 } from 'uuid'

import { Button } from '@components/ui/button'
import { Skeleton } from '@components/ui/skeleton/index.js'

import StructureTree from '@components/Schemas/StructureTree.vue'
import MetricPanel from '@components/Schemas/MetricPanel.vue'
import ComponentPanel from '@components/Schemas/ComponentPanel.vue'
import GroupPanel from '@components/Schemas/GroupPanel.vue'
import ComponentPickerDialog from '@components/Schemas/ComponentPickerDialog.vue'
import RawSchemaDialog from '@components/Schemas/RawSchemaDialog.vue'
import PublishDialog from '@components/Schemas/PublishDialog.vue'

import { useSchemaStore } from '@store/useSchemaStore.js'
import { useSchemaDraftStore } from '@store/useSchemaDraftStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog.js'

import { NodeKind } from '@/lib/schema/constants.js'
import {
  findNode,
  keyAvailable,
  newComponent,
  newComponentList,
  newDocument,
  newGroup,
  newMetric,
  parse,
  referencedSchemas,
  serialise,
} from '@/lib/schema/document.js'
import { classify } from '@/lib/schema/classify.js'
import { blastRadius } from '@/lib/schema/usage.js'
import {
  createDraft,
  deleteDraft,
  isLibrarySchema,
  publishInPlace,
  publishNew,
  saveDraft,
  unresolvedReferences,
  versionOf,
} from '@/lib/schema/registry.js'

export default {
  name: 'SchemaEditor',

  components: {
    Button, ComponentPanel, ComponentPickerDialog, GroupPanel, MetricPanel,
    PublishDialog, RawSchemaDialog, Skeleton, StructureTree,
  },

  setup () {
    return {
      sch: useSchemaStore(),
      drafts: useSchemaDraftStore(),
      dev: useDeviceStore(),
      s: useServiceClientStore(),
      doc: ref(null),
    }
  },

  data () {
    return {
      loading: true,
      loadError: null,
      name: '',
      version: 1,
      schemaUuid: null,
      /* The published schema this edits, or null when it publishes as
       * something new (a fresh schema, or any fork). */
      basedOn: null,
      derivedFrom: null,
      draftUuid: null,
      readonly: false,
      dirty: false,
      saving: false,
      publishing: false,
      selectedId: null,
      pickerOpen: false,
      replacingId: null,
      rawOpen: false,
      publishOpen: false,
      classification: { changes: [], breaking: false, additive: false },
      reach: { configured: [], publishing: null, referencedBy: [] },
      unresolved: [],
    }
  },

  async mounted () {
    await Promise.all([this.sch.start(), this.drafts.start(), this.dev.start()])
    await this.load()
  },

  computed: {
    isDraft () {
      return !!this.draftUuid
    },

    publishedUuids () {
      return new Set((this.sch.data ?? []).map(e => e.uuid))
    },

    schemaNames () {
      const names = {}
      for (const entry of this.sch.data ?? [])
        names[entry.uuid] = `${entry.schemaInformation?.name ?? entry.name} `
          + `(v${versionOf(entry)})`
      for (const entry of this.drafts.data ?? [])
        if (entry.draft) names[entry.draft.schemaUuid] = `${entry.draft.name} (draft)`
      return names
    },

    /* Everything that could be used as a component, minus this schema
     * itself. Self-reference would make an infinite tree, and the ref
     * resolver in the origin map editor would recurse until it died. */
    componentCandidates () {
      const published = (this.sch.data ?? [])
        .filter(e => e.uuid !== this.schemaUuid)
        .map(e => ({
          uuid: e.uuid,
          label: `${e.schemaInformation?.name ?? e.name} (v${versionOf(e)})`,
          isDraft: false,
        }))

      const drafts = (this.drafts.data ?? [])
        .filter(e => e.draft && e.draft.schemaUuid !== this.schemaUuid)
        .map(e => ({
          uuid: e.draft.schemaUuid,
          label: e.draft.name,
          isDraft: true,
        }))

      return [...published, ...drafts]
        .sort((a, b) => a.label.localeCompare(b.label))
    },

    selectedNode () {
      if (!this.doc || !this.selectedId) return null
      return findNode(this.doc, this.selectedId)?.node ?? null
    },

    /* Adding goes into the selected group, or into whichever group holds
     * the selection, so adding after clicking a metric lands beside it. */
    targetContainer () {
      if (!this.doc) return null
      if (!this.selectedId) return this.doc
      const found = findNode(this.doc, this.selectedId)
      if (!found) return this.doc
      if (found.node.kind === NodeKind.GROUP) return found.node
      return found.container
    },

    targetLabel () {
      const container = this.targetContainer
      if (!container || container === this.doc) return 'the top level'
      return container.key
    },

    keyError () {
      const node = this.selectedNode
      if (!node) return null
      const found = findNode(this.doc, node.id)
      if (!found) return null
      if (!node.key?.trim()) return 'A name is required.'
      if (!keyAvailable(found.container, node.key, node.id))
        return 'Something here already has that name.'
      return null
    },

    rawBody () {
      return this.doc ? serialise(this.doc) : {}
    },
  },

  methods: {
    isComponentKind (kind) {
      return kind === NodeKind.COMPONENT || kind === NodeKind.COMPONENT_LIST
    },

    async load () {
      this.loading = true
      this.loadError = null

      try {
        const { mode, id } = this.$route.meta.schemaMode
          ? { mode: this.$route.meta.schemaMode, id: this.$route.params.id }
          : { mode: 'schema', id: this.$route.params.id }

        if (mode === 'new') {
          const uuid = uuidv4()
          this.schemaUuid = uuid
          this.name = 'New schema'
          this.version = 1
          this.basedOn = null
          this.doc = newDocument(uuid, this.name)
          this.dirty = true
        } else if (mode === 'draft') {
          const entry = (this.drafts.data ?? []).find(e => e.uuid === id)
          if (!entry?.draft) throw new Error('That draft no longer exists.')
          this.draftUuid = id
          this.name = entry.draft.name
          this.version = entry.draft.version ?? 1
          this.schemaUuid = entry.draft.schemaUuid
          this.basedOn = entry.draft.basedOn ?? null
          this.derivedFrom = entry.draft.derivedFrom ?? null
          this.doc = parse(entry.draft.body)
        } else {
          const entry = (this.sch.data ?? []).find(e => e.uuid === id)
          if (!entry?.schema) throw new Error('That schema could not be loaded.')
          this.readonly = isLibrarySchema(entry)
          this.name = entry.schemaInformation?.name ?? entry.name
          this.version = versionOf(entry)
          this.schemaUuid = entry.uuid
          this.basedOn = entry.uuid
          this.derivedFrom = entry.schemaInformation?.derivedFrom ?? null
          this.doc = parse(entry.schema)
        }
      } catch (err) {
        console.error('Failed to load schema', err)
        this.loadError = err.message
      } finally {
        this.loading = false
      }
    },

    select (node) {
      this.selectedId = node.id
    },

    touch () {
      this.dirty = true
    },

    rename (value) {
      const node = this.selectedNode
      if (!node) return
      node.key = value
      this.touch()
    },

    addNode (node) {
      const container = this.targetContainer
      container.children.push(node)
      this.selectedId = node.id
      this.touch()
    },

    uniqueKey (base) {
      const container = this.targetContainer
      if (keyAvailable(container, base)) return base
      let n = 2
      while (!keyAvailable(container, `${base}_${n}`)) n++
      return `${base}_${n}`
    },

    addMetric () {
      this.addNode(newMetric(this.uniqueKey('New_Metric')))
    },

    addGroup () {
      this.addNode(newGroup(this.uniqueKey('New_Group')))
    },

    openPicker () {
      this.replacingId = null
      this.pickerOpen = true
    },

    openReplacePicker () {
      this.replacingId = this.selectedId
      this.pickerOpen = true
    },

    chooseComponent ({ ref, asList }) {
      if (this.replacingId) {
        const found = findNode(this.doc, this.replacingId)
        if (found) {
          found.node.ref = ref
          this.touch()
        }
        this.replacingId = null
        return
      }

      const label = (this.schemaNames[ref] ?? 'Component')
        .replace(/\s*\(.*\)$/, '')
        .replace(/[^A-Za-z0-9_]+/g, '_')
      const key = this.uniqueKey(label || 'Component')
      this.addNode(asList ? newComponentList(key, ref) : newComponent(key, ref))
    },

    move ({ node, delta }) {
      const found = findNode(this.doc, node.id)
      if (!found) return
      const list = found.container.children
      const from = list.indexOf(found.node)
      const to = from + delta
      if (to < 0 || to >= list.length) return
      list.splice(to, 0, list.splice(from, 1)[0])
      this.touch()
    },

    remove (node) {
      useDialog({
        title: 'Remove',
        message: node.kind === NodeKind.GROUP && node.children.length
          ? `Remove "${node.key}" and the ${node.children.length} items inside it?`
          : `Remove "${node.key}"?`,
        confirmText: 'Remove',
        onConfirm: () => {
          const found = findNode(this.doc, node.id)
          if (!found) return
          found.container.children = found.container.children
            .filter(n => n.id !== node.id)
          if (this.selectedId === node.id) this.selectedId = null
          this.touch()
        },
      })
    },

    applyRaw (body) {
      try {
        this.doc = parse(body)
        /* The raw view can change the identity. Keep our copy in step so
         * publishing writes the object the body claims to be. */
        if (this.doc.uuid) this.schemaUuid = this.doc.uuid
        this.selectedId = null
        this.touch()
        toast.success('Raw schema applied')
      } catch (err) {
        toast.error('Could not apply that schema', { description: err.message })
      }
    },

    fork () {
      window.events.emit('show-fork-schema-dialog', {
        uuid: this.schemaUuid,
        name: this.name,
        origin: 'AMRC library',
      })
    },

    async save () {
      this.saving = true
      try {
        const body = serialise(this.doc)
        const draft = {
          name: this.name,
          schemaUuid: this.schemaUuid,
          body,
          basedOn: this.basedOn,
          derivedFrom: this.derivedFrom,
          version: this.version,
        }

        if (this.draftUuid) {
          await saveDraft(this.s.client, this.draftUuid, draft)
        } else {
          this.draftUuid = await createDraft(this.s.client, draft)
          this.$router.replace(`/schemas/draft/${this.draftUuid}`)
        }

        this.dirty = false
        toast.success('Draft saved')
      } catch (err) {
        console.error('Failed to save draft', err)
        toast.error('Could not save the draft', { description: err.message })
      } finally {
        this.saving = false
      }
    },

    async openPublish () {
      const body = serialise(this.doc)

      const published = this.basedOn
        ? (this.sch.data ?? []).find(e => e.uuid === this.basedOn)
        : null

      this.classification = published?.schema
        ? classify(published.schema, body)
        : { changes: [], breaking: false, additive: false }

      this.unresolved = unresolvedReferences(
        referencedSchemas(this.doc), this.sch.data)

      this.reach = await blastRadius({
        client: this.s.client,
        schemaUuid: this.basedOn ?? this.schemaUuid,
        devices: this.dev.data,
        schemas: this.sch.data,
      })

      this.publishOpen = true
    },

    async publish () {
      this.publishing = true
      try {
        const body = serialise(this.doc)
        const published = this.basedOn
          ? (this.sch.data ?? []).find(e => e.uuid === this.basedOn)
          : null

        let target

        if (this.basedOn && !this.classification.breaking) {
          /* Every change is additive and the schema is locally authored,
           * so nothing beneath a running device moves. */
          target = await publishInPlace(this.s.client, {
            schemaUuid: this.basedOn,
            name: this.name,
            version: this.version,
            body,
            existing: published?.schemaInformation,
          })
        } else {
          /* A new schema, a fork, or a breaking edit. All three publish
           * as a new object under a new UUID, leaving whatever came
           * before untouched for the devices still on it. */
          const isNewVersion = !!this.basedOn
          const version = isNewVersion ? this.version + 1 : this.version

          if (isNewVersion) {
            /* A breaking edit forks. Mint the new identity here rather
             * than reusing the draft's, which may still be the one the
             * published schema occupies. */
            const uuid = uuidv4()
            this.doc.uuid = uuid
            this.schemaUuid = uuid
          }

          target = await publishNew(this.s.client, {
            name: this.name,
            version,
            body: serialise(this.doc),
            replaces: isNewVersion ? this.basedOn : null,
            derivedFrom: this.derivedFrom,
          })
        }

        if (this.draftUuid) {
          await deleteDraft(this.s.client, this.draftUuid)
          this.draftUuid = null
        }

        this.publishOpen = false
        this.dirty = false
        toast.success(`${this.name} published`)
        this.$router.push(`/schemas/${target}`)
      } catch (err) {
        console.error('Failed to publish schema', err)
        toast.error('Could not publish', { description: err.message })
      } finally {
        this.publishing = false
      }
    },

    leave () {
      if (!this.dirty) {
        this.$router.push('/schemas')
        return
      }
      useDialog({
        title: 'Leave without saving?',
        message: 'This draft has unsaved changes.',
        confirmText: 'Discard',
        onConfirm: () => this.$router.push('/schemas'),
      })
    },
  },

  unmounted () {
    this.sch.stop()
    this.drafts.stop()
    this.dev.stop()
  },
}
</script>

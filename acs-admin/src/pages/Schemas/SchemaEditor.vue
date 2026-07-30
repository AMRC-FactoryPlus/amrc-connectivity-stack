<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex h-[calc(100vh-4rem)] flex-col -m-4">
    <Skeleton v-if="loading" class="m-3 h-full rounded-lg"/>

    <div v-else-if="loadError"
        class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <i class="fa-solid fa-triangle-exclamation fa-2x text-amber-500"></i>
      <p class="text-sm text-gray-600">{{ loadError }}</p>
      <Button variant="outline" @click="$router.push('/schemas')">
        Back to schemas
      </Button>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex h-16 shrink-0 items-center justify-between gap-3 border-b
                  border-slate-200 px-4">
        <div class="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" title="Back"
              @click="leave">
            <i class="fa-solid fa-arrow-left"></i>
          </Button>
          <i class="fa-solid fa-shapes shrink-0 text-slate-500"></i>
          <input v-model="name" :disabled="readonly"
              class="min-w-0 border-b border-transparent bg-transparent text-lg font-bold
                     tracking-tight hover:border-slate-200 focus:border-slate-400
                     focus:outline-none disabled:cursor-default"/>
          <Badge v-if="isDraft" variant="outline"
              class="shrink-0 gap-1.5 border-dashed font-normal">
            <i class="fa-solid fa-pen text-[8px]"></i>Draft
          </Badge>
          <span class="shrink-0 truncate text-xs text-gray-500">{{ statusLine }}</span>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" class="text-slate-500" @click="rawOpen = true">
            <i class="fa-solid fa-code mr-2"></i>Raw JSON
          </Button>
          <div class="h-5 w-px bg-slate-200"></div>
          <Button v-if="readonly" size="sm" @click="fork">
            <i class="fa-solid fa-code-branch mr-2"></i>Make a local copy
          </Button>
          <template v-else>
            <Button variant="outline" size="sm" :disabled="saving || !dirty" @click="save">
              <i v-if="saving" class="fa-solid fa-circle-notch fa-spin mr-2"></i>Save
            </Button>
            <Button size="sm" @click="openPublish">
              <i class="fa-solid fa-rocket mr-2"></i>Publish
            </Button>
          </template>
        </div>
      </div>

      <div v-if="readonly"
          class="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-gray-50
                 px-4 py-2 text-xs text-gray-600">
        <i class="fa-solid fa-lock text-slate-400"></i>
        This schema comes from the AMRC library. Editing creates a local copy.
      </div>

      <!-- Body -->
      <div class="flex min-h-0 flex-1">
        <div class="flex w-[400px] shrink-0 flex-col border-r border-slate-200">
          <div class="flex shrink-0 items-center gap-2 border-b border-slate-200 p-3">
            <div class="relative flex-1">
              <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center
                           pl-3 text-xs text-gray-400">
                <i class="fa-solid fa-search"></i>
              </span>
              <Input v-model="filter" class="h-8 pl-8" placeholder="Filter nodes..."/>
            </div>
            <DropdownMenu v-if="!readonly">
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="h-8 shrink-0">
                  <i class="fa-solid fa-plus mr-2"></i>Add
                  <i class="fa-solid fa-chevron-down ml-2 text-[9px] opacity-50"></i>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-56">
                <DropdownMenuLabel class="text-xs font-normal text-gray-500">
                  Adding into {{ targetLabel }}
                </DropdownMenuLabel>
                <DropdownMenuSeparator/>
                <DropdownMenuItem @click="addMetric">
                  <i class="fa-solid fa-gauge fa-fw mr-2 text-slate-400"></i>Metric
                </DropdownMenuItem>
                <DropdownMenuItem @click="openPicker">
                  <i class="fa-solid fa-cube fa-fw mr-2 text-slate-700"></i>Component
                </DropdownMenuItem>
                <DropdownMenuItem @click="addGroup">
                  <i class="fa-solid fa-folder fa-fw mr-2 text-amber-500"></i>Group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <!-- Reserved properties live here rather than in the tree, so
               everything in the tree is something the user can edit. -->
          <div class="shrink-0 border-b border-slate-200 bg-gray-50 px-3 py-2.5">
            <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.05em]
                        text-gray-400">
              Set by the platform
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="node in reservedNodes" :key="node.id"
                  class="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5
                         font-mono text-xs text-gray-500">
                {{ node.key }}
              </span>
              <span v-if="!reservedNodes.length" class="text-xs text-gray-400">
                None
              </span>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-2">
            <StructureTree
                :nodes="visibleNodes"
                :selected-id="selectedId"
                :readonly="readonly"
                :schema-names="schemaNames"
                @select="select"
                @remove="remove"
                @move="move"/>
            <p v-if="filter && !visibleNodes.length"
                class="p-3 text-center text-xs text-gray-400">
              Nothing matches "{{ filter }}".
            </p>
          </div>

          <div class="flex shrink-0 items-center justify-between border-t border-slate-200
                      px-3 py-2 text-[10px] text-gray-400">
            <span>{{ nodeCount }} nodes</span>
            <span v-if="filter">{{ visibleCount }} shown</span>
          </div>
        </div>

        <div class="flex min-w-0 flex-1 flex-col">
          <template v-if="selectedNode">
            <div class="flex shrink-0 items-center justify-between border-b
                        border-slate-200 px-5 py-3.5">
              <div>
                <div class="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <template v-for="(segment, i) in breadcrumb" :key="i">
                    <span v-if="i" class="text-[10px] text-gray-400">
                      <i class="fa-solid fa-chevron-right"></i>
                    </span>
                    <span :class="i === breadcrumb.length - 1
                      ? 'text-slate-950 font-mono' : ''">{{ segment }}</span>
                  </template>
                </div>
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-fw" :class="[selectedPresentation.icon,
                    selectedPresentation.colour]"></i>
                  <span class="text-xl font-semibold tracking-tight">
                    {{ selectedPresentation.title }}
                  </span>
                </div>
              </div>
              <Button v-if="!readonly && selectedNode.kind !== 'reserved'"
                  variant="destructiveGhost" size="sm" @click="remove(selectedNode)">
                <i class="fa-solid fa-trash mr-2"></i>Delete
              </Button>
            </div>

            <div class="flex-1 overflow-y-auto p-5">
              <MetricPanel v-if="selectedNode.kind === 'metric'"
                  :node="selectedNode" :readonly="readonly" :key-error="keyError"
                  @rename="rename" @change="touch"/>
              <ComponentPanel v-else-if="isComponentKind(selectedNode.kind)"
                  :node="selectedNode" :readonly="readonly" :key-error="keyError"
                  :schema-names="schemaNames" :published-uuids="publishedUuids"
                  :library-uuids="libraryUuids" :draft-uuids="draftUuids"
                  @rename="rename" @change="touch" @pick="openReplacePicker"/>
              <GroupPanel v-else-if="selectedNode.kind === 'group'"
                  :node="selectedNode" :readonly="readonly" :key-error="keyError"
                  @rename="rename"/>
              <OpaquePanel v-else :node="selectedNode"/>
            </div>
          </template>

          <div v-else class="flex flex-1 items-center justify-center">
            <div class="text-center">
              <i class="fa-solid fa-gauge fa-2x text-slate-300"></i>
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

    <RawSchemaDialog v-model:open="rawOpen" :body="rawBody" @apply="applyRaw"/>
  </div>
</template>

<script>
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { v4 as uuidv4 } from 'uuid'

import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Input } from '@components/ui/input'
import { Skeleton } from '@components/ui/skeleton/index.js'

import StructureTree from '@components/Schemas/StructureTree.vue'
import MetricPanel from '@components/Schemas/MetricPanel.vue'
import ComponentPanel from '@components/Schemas/ComponentPanel.vue'
import GroupPanel from '@components/Schemas/GroupPanel.vue'
import OpaquePanel from '@components/Schemas/OpaquePanel.vue'
import ComponentPickerDialog from '@components/Schemas/ComponentPickerDialog.vue'
import RawSchemaDialog from '@components/Schemas/RawSchemaDialog.vue'

import { useSchemaStore } from '@store/useSchemaStore.js'
import { useSchemaDraftStore } from '@store/useSchemaDraftStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog.js'

import { NodeKind } from '@/lib/schema/constants.js'
import { presentationFor } from '@/lib/schema/presentation.js'
import {
  findNode, keyAvailable, newComponent, newComponentList, newDocument, newGroup,
  newMetric, parse, pathOf, serialise, walk,
} from '@/lib/schema/document.js'
import {
  createDraft, isLibrarySchema, saveDraft, versionOf,
} from '@/lib/schema/registry.js'

export default {
  name: 'SchemaEditor',

  components: {
    Badge, Button, ComponentPanel, ComponentPickerDialog, DropdownMenu,
    DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
    DropdownMenuTrigger, GroupPanel, Input, MetricPanel, OpaquePanel,
    RawSchemaDialog, Skeleton, StructureTree,
  },

  setup () {
    return {
      sch: useSchemaStore(),
      drafts: useSchemaDraftStore(),
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
      basedOn: null,
      derivedFrom: null,
      draftUuid: null,
      readonly: false,
      dirty: false,
      saving: false,
      selectedId: null,
      filter: '',
      pickerOpen: false,
      replacingId: null,
      rawOpen: false,
    }
  },

  async mounted () {
    await Promise.all([this.sch.start(), this.drafts.start()])
    await this.load()
    /* Closing the tab or reloading is the browser's to warn about. */
    window.addEventListener('beforeunload', this.warnIfDirty)
  },

  /* Navigating away inside the app never reaches beforeunload, so the
   * router has to ask. beforeRouteUpdate covers moving between two
   * schemas, which reuses this component and so is not a "leave". */
  beforeRouteLeave (to, from, next) {
    this.confirmDiscard(next)
  },

  beforeRouteUpdate (to, from, next) {
    this.confirmDiscard(next)
  },

  watch: {
    /* Opening a component navigates from one schema to another, and
     * both routes render this component. Vue reuses the instance rather
     * than remounting, so without this the URL changed and nothing
     * else did. */
    '$route.fullPath' () {
      if (!this.$route.path.startsWith('/schemas')) return
      if (this.$route.path.endsWith('/publish')) return
      this.load()
    },
  },

  computed: {
    isDraft () {
      return !!this.draftUuid
    },

    statusLine () {
      if (this.readonly) return 'AMRC library'
      if (!this.basedOn) return `Version ${this.version}, not yet published`
      const published = this.publishedEntry
      const devices = published ? '' : ''
      return this.isDraft
        ? `Version ${this.version} draft${devices}`
        : `Version ${this.version}`
    },

    publishedEntry () {
      return this.basedOn
        ? (this.sch.data ?? []).find(e => e.uuid === this.basedOn)
        : null
    },

    publishedUuids () {
      return new Set((this.sch.data ?? []).map(e => e.uuid))
    },

    libraryUuids () {
      return new Set((this.sch.data ?? [])
        .filter(isLibrarySchema).map(e => e.uuid))
    },

    /* Schema UUID to the draft object that will publish it, so an
     * unpublished component can still be opened. */
    draftUuids () {
      const map = {}
      for (const entry of this.drafts.data ?? [])
        if (entry.draft) map[entry.draft.schemaUuid] = entry.uuid
      return map
    },

    schemaNames () {
      const names = {}
      for (const entry of this.sch.data ?? [])
        names[entry.uuid] = `${entry.schemaInformation?.name ?? entry.name} `
          + `v${versionOf(entry)}`
      for (const entry of this.drafts.data ?? [])
        if (entry.draft) names[entry.draft.schemaUuid] = `${entry.draft.name} (draft)`
      return names
    },

    componentCandidates () {
      const published = (this.sch.data ?? [])
        .filter(e => e.uuid !== this.schemaUuid)
        .map(e => ({
          uuid: e.uuid,
          label: `${e.schemaInformation?.name ?? e.name} v${versionOf(e)}`,
          origin: isLibrarySchema(e) ? 'AMRC library' : 'Local',
          isDraft: false,
        }))

      const drafts = (this.drafts.data ?? [])
        .filter(e => e.draft && e.draft.schemaUuid !== this.schemaUuid)
        .map(e => ({
          uuid: e.draft.schemaUuid,
          label: e.draft.name,
          origin: 'Draft',
          isDraft: true,
        }))

      return [...published, ...drafts]
        .sort((a, b) => a.label.localeCompare(b.label))
    },

    /* Reserved properties are shown above the tree, not in it. */
    reservedNodes () {
      return (this.doc?.children ?? [])
        .filter(n => n.kind === NodeKind.RESERVED)
    },

    editableNodes () {
      return (this.doc?.children ?? [])
        .filter(n => n.kind !== NodeKind.RESERVED)
    },

    visibleNodes () {
      const term = this.filter.trim().toLowerCase()
      if (!term) return this.editableNodes

      /* A group survives the filter if it or any descendant matches, so
       * filtering never hides the path to a hit. */
      const prune = (nodes) => nodes.reduce((kept, node) => {
        const hit = node.key.toLowerCase().includes(term)
        if (node.kind === NodeKind.GROUP) {
          const children = prune(node.children ?? [])
          if (hit || children.length)
            kept.push(hit ? node : { ...node, children })
        } else if (hit) {
          kept.push(node)
        }
        return kept
      }, [])

      return prune(this.editableNodes)
    },

    nodeCount () {
      let n = 0
      if (this.doc) walk(this.doc, () => n++)
      return n
    },

    visibleCount () {
      let n = 0
      const count = (nodes) => {
        for (const node of nodes) {
          n++
          if (node.kind === NodeKind.GROUP) count(node.children ?? [])
        }
      }
      count(this.visibleNodes)
      return n
    },

    selectedNode () {
      if (!this.doc || !this.selectedId) return null
      return findNode(this.doc, this.selectedId)?.node ?? null
    },

    selectedPresentation () {
      return presentationFor(this.selectedNode?.kind)
    },

    breadcrumb () {
      if (!this.selectedNode) return []
      return [this.name, ...(pathOf(this.doc, this.selectedId) ?? [])]
    },

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

      /* Reset everything the previous schema left behind. This runs on
       * navigation between schemas, not just on mount, so anything not
       * cleared here leaks from one to the next. */
      this.draftUuid = null
      this.basedOn = null
      this.derivedFrom = null
      this.readonly = false
      this.dirty = false
      this.selectedId = null
      this.filter = ''
      this.doc = null

      try {
        const mode = this.$route.meta.schemaMode ?? 'schema'
        const id = this.$route.params.id

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
      this.targetContainer.children.push(node)
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
        .replace(/\s+v\d+$/, '')
        .replace(/\s*\(draft\)$/, '')
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

    draftPayload () {
      return {
        name: this.name,
        schemaUuid: this.schemaUuid,
        body: serialise(this.doc),
        basedOn: this.basedOn,
        derivedFrom: this.derivedFrom,
        version: this.version,
      }
    },

    async save () {
      this.saving = true
      try {
        if (this.draftUuid) {
          await saveDraft(this.s.client, this.draftUuid, this.draftPayload())
        } else {
          this.draftUuid = await createDraft(this.s.client, this.draftPayload())
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

    /* Publishing is a place of its own, not a dialog over the editor.
     * It has a verdict to deliver and evidence to show for it. */
    async openPublish () {
      if (this.dirty || !this.draftUuid) await this.save()
      if (this.draftUuid) this.$router.push(`/schemas/draft/${this.draftUuid}/publish`)
    },

    /* Fired by the browser on close, reload, or navigation out of the
     * app. Setting returnValue is what triggers the native prompt; the
     * wording is the browser's and cannot be set. */
    warnIfDirty (event) {
      if (!this.dirty) return
      event.preventDefault()
      event.returnValue = ''
      return ''
    },

    /* Native confirm rather than the app dialog: a router guard has to
     * decide synchronously, and the app dialog can be dismissed without
     * answering, which would strand the navigation. */
    confirmDiscard (next) {
      if (!this.dirty) return next()
      const ok = window.confirm(
        `${this.name} has unsaved changes. Leave without saving?`)
      next(ok)
    },

    leave () {
      /* The route guard asks about unsaved work. */
      this.$router.push('/schemas')
    },
  },

  unmounted () {
    window.removeEventListener('beforeunload', this.warnIfDirty)
    this.sch.stop()
    this.drafts.stop()
  },
}
</script>

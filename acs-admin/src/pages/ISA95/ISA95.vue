<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <BridgesContainer>
    <div class="flex flex-col h-full gap-3">
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center gap-2">
        <div v-if="view === 'tree'" class="relative w-[300px] max-w-full">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
          <Input v-model="q" type="search" class="h-9 pl-8" placeholder="Search names and aliases..."
              aria-label="Search the hierarchy by name or alias" :disabled="!isa95.ready"/>
        </div>
        <div class="inline-flex rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="View">
          <button v-for="v in VIEWS" :key="v.id" type="button" role="tab" :aria-selected="view === v.id"
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm"
              :class="view === v.id ? 'bg-white shadow-sm font-medium' : 'text-slate-600 hover:text-slate-900'"
              @click="view = v.id">
            <i class="fa-solid fa-xs" :class="v.icon"></i>{{ v.label }}
          </button>
        </div>
        <template v-if="view === 'tree'">
          <Button variant="ghost" size="sm" class="gap-2" :disabled="!isa95.ready" @click="expandAll">
            <i class="fa-solid fa-angles-down fa-xs"></i>Expand all
          </Button>
          <Button variant="ghost" size="sm" class="gap-2" :disabled="!isa95.ready" @click="open = new Set()">
            <i class="fa-solid fa-angles-up fa-xs"></i>Collapse all
          </Button>
        </template>
        <span class="flex-1"></span>
        <Button v-if="canPlace" variant="outline" size="sm" class="gap-2" @click="importPlacements">
          <i class="fa-solid fa-file-import"></i>Import placements
        </Button>
        <Button v-if="canCreate('Enterprise')" size="sm" class="gap-2" @click="newEnterprise">
          <i class="fa-solid fa-plus"></i>Enterprise
        </Button>
        <span v-if="isa95.ready && !canEdit" class="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <i class="fa-solid fa-lock fa-xs"></i>View only
        </span>
      </div>
      <div v-if="isa95.ready && !canEdit" class="text-xs text-slate-500 -mt-1">
        You can view this hierarchy but not change it. Adding, renaming, moving and merging nodes needs edit rights on the ISA-95 vocabulary.
      </div>

      <!-- Loading -->
      <div v-if="!isa95.ready" class="flex-1 rounded-md border border-slate-200 p-2 space-y-1.5">
        <div v-for="i in 12" :key="i" class="flex items-center gap-2 h-[30px]" :style="{ paddingLeft: `${8 + ((i * 7) % 4) * 20}px` }">
          <Skeleton class="h-3.5 w-4"/><Skeleton class="h-5 w-20"/><Skeleton class="h-3.5" :class="['w-40', 'w-28', 'w-52', 'w-36'][i % 4]"/>
          <Skeleton class="h-3.5 w-7 ml-auto"/>
        </div>
      </div>

      <!-- Empty -->
      <EmptyState v-else-if="!isa95.data.length"
          title="No ISA-95 hierarchy yet"
          description="Devices are placed on the nodes of this hierarchy, and a device's place becomes the address of its data in the Unified Namespace. Start with an Enterprise, which is usually your organisation."
          :button-text="canCreate('Enterprise') ? 'Enterprise' : ''"
          button-icon="plus"
          @button-click="newEnterprise"/>

      <ISA95Tree v-else-if="view === 'tree'"
          ref="tree"
          :vocab="vocab"
          :rows="rows"
          :counts="counts"
          :flags="flags"
          :query="q"
          :selected-key="selectedKey"
          :can-edit="canEdit"
          :can-create="canCreate"
          :can-delete="canDeleteNode"
          @select="r => select(r.uuid, r.key)"
          @toggle="toggle"
          @open="k => setOpen(k, true)"
          @expand-under="expandUnder"
          @move="r => moveNode(r.uuid, r.parent)"
          @merge="(uuid, into) => mergeNode(uuid, into)"
          @reveal="reveal"
          @clear-search="q = ''"/>

      <DataTableSearchable v-else
          :columns="columns"
          :data="listRows"
          :limit-height="false"
          :clickable="true"
          :filters="filters"
          :selected-objects="[]"
          :default-sort="[{ id: 'level', desc: false }]"
          @row-click="e => select(e.original.uuid, null)"/>
    </div>

    <template v-slot:sidebar>
      <aside v-if="selectedNode" class="w-96 shrink-0 border-l border-slate-200 overflow-y-auto" aria-label="Node details">
        <div class="p-4 border-b border-slate-200 space-y-1">
          <nav class="flex flex-wrap items-center gap-1 text-xs text-slate-500" aria-label="Path">
            <template v-for="(c, i) in crumbs" :key="c.uuid">
              <button type="button" class="hover:text-slate-900 hover:underline" @click="reveal(c.uuid)">{{ c.name }}</button>
              <span v-if="i < crumbs.length - 1" aria-hidden="true">/</span>
            </template>
          </nav>
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-sitemap text-slate-500"></i>
            <span class="font-semibold text-xl truncate">{{ selectedNode.name }}</span>
            <span class="text-[10px] uppercase tracking-wide text-slate-500 border border-slate-200 rounded px-1">{{ selectedNode.level }}</span>
          </div>
        </div>

        <div class="p-4 border-b border-slate-200 space-y-2">
          <div class="flex flex-wrap gap-2">
            <I3xAccessButton :target="selectedNode.uuid" :via="selectedVia" :noun="selectedNode.level.toLowerCase()"
                :name="selectedNode.name" :path="[...selectedVia, selectedNode].map(n => n.name).join(' / ')"/>
            <template v-if="canEdit">
              <Button variant="outline" size="sm" class="gap-2" @click="renameSelected">
                <i class="fa-solid fa-pen fa-xs"></i>Rename
              </Button>
              <Button v-if="selectedNode.level !== 'Enterprise'" variant="outline" size="sm" class="gap-2"
                  @click="moveNode(selectedNode.uuid, selectedParent)">
                <i class="fa-solid fa-arrows-up-down-left-right fa-xs"></i>Move to...
              </Button>
              <Button v-if="canDelete" variant="outline" size="sm" class="gap-2" @click="mergeNode(selectedNode.uuid)">
                <i class="fa-solid fa-code-merge fa-xs"></i>Merge into...
              </Button>
              <Button v-if="canDelete" variant="outline" size="sm" class="gap-2 text-red-600" @click="deleteNode">
                <i class="fa-solid fa-trash fa-xs"></i>Delete
              </Button>
            </template>
          </div>
          <div class="text-xs text-slate-500">
            An i3X grant here covers every device under {{ selectedNode.name }}, and any added later.
          </div>
        </div>

        <div v-if="duplicateOf" class="m-4 rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm" role="note">
          <div class="flex items-center gap-2 font-semibold text-amber-900">
            <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>Possible duplicate of {{ duplicateOf.name }}
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-x-4 text-xs text-amber-900">
            <span>{{ duplicateOf.name }}</span><span class="tabular-nums">{{ devicesText(duplicateOf.uuid) }}</span>
            <span>{{ selectedNode.name }}</span><span class="tabular-nums">{{ devicesText(selectedNode.uuid) }}</span>
          </div>
          <Button v-if="canEdit && canDelete" variant="outline" size="sm" class="gap-2 bg-white"
              @click="mergeNode(selectedNode.uuid, duplicateOf.uuid)">
            <i class="fa-solid fa-code-merge fa-xs"></i>Merge into {{ duplicateOf.name }}...
          </Button>
          <div v-else class="text-xs text-amber-800">Someone with edit rights to the hierarchy can merge it.</div>
        </div>

        <div class="space-y-4 p-4">
          <SidebarDetail icon="microchip" label="Devices" :value="devicesDetail"/>
          <SidebarDetail icon="tags" label="Aliases" :value="selectedNode.aliases.join(', ') || null"/>
          <SidebarDetail icon="turn-up" label="Parents" :value="parentNames || null"/>
          <SidebarDetail icon="turn-down" label="Children" :value="childNames || null"/>
          <SidebarDetail icon="key" label="Node UUID" :value="selectedNode.uuid"/>
        </div>
      </aside>
      <aside v-else-if="isa95.ready && isa95.data.length" class="w-96 shrink-0 border-l border-slate-200 p-6 text-sm text-slate-500">
        Select a node to see its details.
      </aside>
    </template>
  </BridgesContainer>
</template>

<script>
import { Button } from "@components/ui/button/index.js";
import { Input } from "@components/ui/input/index.js";
import { Skeleton } from "@components/ui/skeleton/index.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import BridgesContainer from '@components/Containers/BridgesContainer.vue';
import { isa95Columns } from "./isa95Columns.ts";
import { ISA95_LEVELS, ISA95_LEVEL_CLASSES, useISA95Store } from "@store/useISA95Store.js";
import { useAccessStore } from "@store/useAccessStore.js";
import SidebarDetail from "@components/SidebarDetail.vue";
import EmptyState from '@components/EmptyState.vue';
import ISA95Tree from '@components/ISA95/ISA95Tree.vue';
import { UUIDs } from "@amrc-factoryplus/service-client";
import { useDialog } from '@/composables/useDialog';
import { useServiceClientStore } from "@store/serviceClientStore";
import { useDeviceStore } from "@store/useDeviceStore.js";
import { toast } from "vue-sonner";
import I3xAccessButton from "@components/Access/I3xAccessButton.vue";
import { isa95_path } from "@/lib/access/i3x-access.js";
import { devices_placed_under } from "@/lib/isa95-placement.js";
import {
  all_branch_keys, device_counts, duplicate_flags, tree_rows,
} from "@/lib/isa95-hierarchy.js";

const VIEWS = [
  { id: 'tree', label: 'Tree', icon: 'fa-sitemap' },
  { id: 'list', label: 'List', icon: 'fa-list' },
]

export default {
  name: 'ISA95',
  components: {
    SidebarDetail, DataTableSearchable, Skeleton, Button, Input, BridgesContainer,
    EmptyState, I3xAccessButton, ISA95Tree,
  },

  setup() {
    return {
      VIEWS,
      isa95: useISA95Store(),
      columns: isa95Columns,
      s: useServiceClientStore(),
      d: useDeviceStore(),
      access: useAccessStore(),
    }
  },

  data() {
    return {
      view: 'tree',
      q: '',
      /* Row keys (UUID paths) the user has opened. Replaced, not
       * mutated, so the tree recomputes. */
      open: new Set(),
      selectedUuid: null,
      /* Which appearance of the node is selected, for a node shown
       * under two parents. Null when selected from the list. */
      selectedKey: null,
      /* Open the top level the first time the vocabulary arrives. */
      openedTop: false,
    }
  },

  async mounted() {
    /* Device counts, and deleting and merging, need each device's placement. */
    if (!this.d.rxsub) this.d.start();
    window.events.on('isa95-node-merged', this.reveal);
    window.events.on('isa95-node-moved', this.onMoved);
    await this.isa95.start();
  },

  watch: {
    'isa95.ready': {
      immediate: true,
      handler(ready) {
        if (!ready || this.openedTop) return
        this.openedTop = true
        /* Open each Enterprise so the Sites show straight away. */
        this.open = new Set(this.isa95.enterprises.map(e => e.uuid))
      },
    },
  },

  computed: {
    vocab() {
      return this.isa95.vocabulary
    },
    placements() {
      return (this.d.data ?? []).map(d => [d.uuid, d.placement])
    },
    counts() {
      return device_counts(this.vocab, this.placements)
    },
    flags() {
      return duplicate_flags(this.vocab, this.counts)
    },
    rows() {
      return tree_rows(this.vocab, { open: this.open, query: this.q })
    },
    listRows() {
      return this.isa95.data.map(n => ({
        ...n,
        parents: this.isa95.parents_of(n.uuid).map(p => p.name),
      }))
    },
    filters() {
      return [{
        name: 'Level',
        property: 'level',
        options: ISA95_LEVELS.map(l => ({ label: l, value: l })),
      }]
    },

    /* Hide what the user's ACL can't do. */
    canEdit() {
      return this.access.check.write_apps(UUIDs.App.Info, UUIDs.App.ISA95Vocabulary);
    },
    canPlace() {
      return this.access.check.write_apps(UUIDs.App.ISA95Placement);
    },
    canDelete() {
      return !!this.selectedNode && this.canDeleteNode(this.selectedNode.uuid);
    },

    /* Resolve the selection from the store so it stays live after edits. */
    selectedNode() {
      if (!this.selectedUuid) return null;
      return this.isa95.by_uuid(this.selectedUuid) ?? null;
    },
    /* The parent the selected row sits under in the tree. */
    selectedParent() {
      const parts = this.selectedKey?.split('/') ?? []
      return parts.length > 1 ? parts.at(-2) : this.vocab.parents.get(this.selectedUuid)?.[0] ?? null
    },
    /* The nodes above the selected one, whose grants also cover it. */
    selectedVia() {
      return isa95_path(this.isa95.data, this.selectedUuid).slice(0, -1);
    },
    crumbs() {
      const uuids = this.selectedKey?.split('/') ?? this.firstPath(this.selectedUuid)
      return uuids.map(u => this.vocab.nodes.get(u)).filter(Boolean)
    },
    duplicateOf() {
      const orig = this.flags.get(this.selectedUuid)
      return orig ? this.vocab.nodes.get(orig) ?? null : null
    },
    devicesDetail() {
      const c = this.counts.get(this.selectedUuid) ?? { here: 0, total: 0 }
      return `${c.here} here, ${c.total} including below`
    },
    parentNames() {
      return this.isa95.parents_of(this.selectedUuid).map(p => p.name).join(', ');
    },
    childNames() {
      return this.isa95.children_of(this.selectedUuid).map(c => c.name).join(', ');
    },
  },

  methods: {
    canCreate(level) {
      const cls = ISA95_LEVEL_CLASSES[level]
      return !!cls && this.canEdit && this.access.check.create_in(cls)
    },
    canDeleteNode(uuid) {
      return this.canEdit && this.access.check.delete_obj(uuid)
    },
    devicesText(uuid) {
      const n = this.counts.get(uuid)?.total ?? 0
      return n === 1 ? '1 device' : `${n} devices`
    },

    select(uuid, key) {
      this.selectedUuid = uuid ?? null
      this.selectedKey = key ?? null
    },
    setOpen(key, on) {
      const next = new Set(this.open)
      on ? next.add(key) : next.delete(key)
      this.open = next
    },
    toggle(key) {
      this.setOpen(key, !this.open.has(key))
    },
    expandAll() {
      this.open = all_branch_keys(this.vocab)
    },
    expandUnder(key) {
      const next = new Set(this.open)
      for (const k of all_branch_keys(this.vocab))
        if (k === key || k.startsWith(key + '/')) next.add(k)
      this.open = next
    },

    /* The UUIDs from the top down to a node, through first parents. */
    firstPath(uuid) {
      const out = []
      const seen = new Set()
      for (let u = uuid; u && !seen.has(u); u = this.vocab.parents.get(u)?.[0]) {
        seen.add(u)
        out.unshift(u)
      }
      return out
    },
    /* After a move, show the node where it now is. */
    onMoved({ uuid, to }) {
      this.reveal(uuid, to)
    },
    /* Open the tree down to a node and select it. With `via`, go
     * through that parent, for a node with more than one. */
    reveal(uuid, via) {
      if (!uuid) return
      const path = via ? [...this.firstPath(via), uuid] : this.firstPath(uuid)
      const next = new Set(this.open)
      for (let i = 1; i < path.length; i++) next.add(path.slice(0, i).join('/'))
      this.open = next
      this.view = 'tree'
      this.q = ''
      this.select(uuid, path.join('/'))
      this.$nextTick(() => document.querySelector('[role=treeitem][aria-selected=true]')?.scrollIntoView({ block: 'nearest' }))
    },

    newEnterprise() {
      this.view = 'tree'
      this.q = ''
      this.$nextTick(() => this.$refs.tree?.startAdd(null))
    },
    renameSelected() {
      const row = this.view === 'tree' && this.rows.find(r => r.key === this.selectedKey)
      if (row) this.$refs.tree.startRename(row)
      else window.events.emit('show-new-isa95-node-dialog', this.selectedNode)
    },
    importPlacements() {
      window.events.emit('show-isa95-placement-import-dialog')
    },
    moveNode(uuid, from) {
      window.events.emit('show-isa95-move-dialog', { node: this.vocab.nodes.get(uuid), from })
    },
    mergeNode(uuid, into) {
      window.events.emit('show-isa95-merge-dialog', { node: this.vocab.nodes.get(uuid), into })
    },
    deleteNode() {
      const node = this.selectedNode;
      if (node.children.length > 0) {
        toast.error('This node has children', {
          description: 'Delete or reassign its children first.',
        });
        return;
      }
      if (!this.d.ready) {
        toast.error('Devices are still loading', {
          description: 'Try again in a moment.',
        });
        return;
      }
      const placements = new Map(this.placements);
      const placed = devices_placed_under(this.vocab, placements, node.uuid);
      if (placed.length > 0) {
        toast.error(`${placed.length} device${placed.length === 1 ? ' is' : 's are'} placed on ${node.name}`, {
          description: 'Move them to another node first, or merge this node into another one.',
        });
        return;
      }
      useDialog({
        title: 'Delete Node',
        message: `Delete "${node.name}" from the ISA-95 vocabulary? No devices are placed on it. You cannot undo this.`,
        confirmText: 'Delete',
        destructive: true,
        onConfirm: async () => {
          try {
            const cdb = this.s.client.ConfigDB;
            /* Unlink from every parent before deleting, so no vocabulary
             * config is left pointing at a dead UUID. */
            for (const parent of this.isa95.parents_of(node.uuid)) {
              await cdb.put_config(UUIDs.App.ISA95Vocabulary, parent.uuid, {
                aliases: parent.aliases,
                children: parent.children.filter(c => c !== node.uuid),
              });
            }
            await cdb.delete_object(node.uuid);
            toast.success('Node deleted successfully');
            this.select(null, null);
          } catch (err) {
            console.error('Failed to delete node:', err);
            toast.error('Failed to delete node', {
              description: err.message || 'An unexpected error occurred'
            });
          }
        }
      })
    },
  },

  unmounted() {
    window.events.off('isa95-node-merged', this.reveal);
    window.events.off('isa95-node-moved', this.onMoved);
    this.isa95.stop();
  }
}
</script>

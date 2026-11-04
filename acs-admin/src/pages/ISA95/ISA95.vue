<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <BridgesContainer>
    <Skeleton v-if="!isa95.ready" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
    <DataTableSearchable v-else
      :columns="columns"
      :data="rows"
      :limit-height="false"
      :clickable="true"
      :filters="filters"
      :selected-objects="[]"
      :default-sort="initialSort"
      @row-click="e => nodeClick(e.original)"
    >
      <template #toolbar-right>
        <Button variant="outline" class="gap-2" @click="importPlacements">
          <i class="fa-solid fa-file-import"></i>
          <span>Import placements</span>
        </Button>
        <Button class="gap-2" @click="newNode">
          <i class="fa-solid fa-plus"></i>
          <span>New Node</span>
        </Button>
      </template>
      <template #empty>
        <EmptyState
          title="No ISA-95 Hierarchy"
          description="No ISA-95 hierarchy has been configured yet. Create an Enterprise to start building the hierarchy."
          button-text="New Node"
          button-icon="plus"
          @button-click="newNode"/>
      </template>
    </DataTableSearchable>
    <template v-slot:sidebar>
      <!-- Sidebar -->
      <div v-if="selectedNode" class="w-96 border-l border-border -mr-4">
        <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
          <div class="flex items-center gap-2 w-full mr-3">
            <div class="flex items-center gap-2">
              <i class="fa-fw fa-solid fa-sitemap"></i>
              <div class="font-semibold text-xl">Node Details</div>
            </div>
            <Button title="Edit Node" size="xs" class="flex gap-1 ml-auto" @click="editNode" variant="ghost">
              <i class="fa-solid fa-pen text-gray-400"></i>
            </Button>
            <Button title="Merge into..." size="xs" class="flex gap-1" @click="mergeNode" variant="ghost">
              <i class="fa-solid fa-code-merge text-gray-400"></i>
            </Button>
            <Button title="Delete Node" size="xs" class="flex gap-1" @click="deleteNode" variant="ghost">
              <i class="fa-solid fa-trash text-red-400"></i>
            </Button>
          </div>
        </div>
        <!-- Who can read the devices under this node through i3X -->
        <div class="flex flex-col items-start gap-2 p-4 border-b">
          <I3xAccessButton :target="selectedNode.uuid" :via="selectedVia" :noun="selectedNode.level.toLowerCase()"
                           :name="selectedNode.name" :path="[...selectedVia, selectedNode].map(n => n.name).join(' / ')"/>
          <div class="text-xs text-gray-500">
            A grant here covers every device under {{ selectedNode.name }}, and any added later.
          </div>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
            icon="key"
            label="Node UUID"
            :value="selectedNode.uuid"
          />
          <SidebarDetail
            icon="tag"
            label="Name"
            :value="selectedNode.name"
          />
          <SidebarDetail
            icon="layer-group"
            label="Level"
            :value="selectedNode.level"
          />
          <SidebarDetail
            icon="turn-up"
            label="Parent"
            :value="parentNames"
          />
          <SidebarDetail
            icon="tags"
            label="Aliases"
            :value="aliasNames"
          />
          <SidebarDetail
            icon="turn-down"
            label="Children"
            :value="childNames"
          />
        </div>
      </div>
    </template>
  </BridgesContainer>
</template>

<script>
import { Button } from "@components/ui/button/index.js";
import { Skeleton } from "@components/ui/skeleton/index.js";
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import BridgesContainer from '@components/Containers/BridgesContainer.vue';
import { isa95Columns } from "./isa95Columns.ts";
import { ISA95_LEVELS, useISA95Store } from "@store/useISA95Store.js";
import SidebarDetail from "@components/SidebarDetail.vue";
import EmptyState from '@components/EmptyState.vue';
import { ref } from "vue";
import { UUIDs } from "@amrc-factoryplus/service-client";
import { useDialog } from '@/composables/useDialog';
import { useServiceClientStore } from "@store/serviceClientStore";
import { useDeviceStore } from "@store/useDeviceStore.js";
import { toast } from "vue-sonner";
import I3xAccessButton from "@components/Access/I3xAccessButton.vue";
import { isa95_path } from "@/lib/access/i3x-access.js";
import { devices_placed_under } from "@/lib/isa95-placement.js";

export default {
  name: 'ISA95',
  components: { SidebarDetail, DataTableSearchable, Skeleton, Button, BridgesContainer, EmptyState, I3xAccessButton },

  setup() {
    return {
      selectedUuid: ref(null),
      isa95: useISA95Store(),
      columns: isa95Columns,
      s: useServiceClientStore(),
      d: useDeviceStore(),
    }
  },

  async mounted() {
    /* Deleting and merging nodes need each device's placement. */
    if (!this.d.rxsub) this.d.start();
    window.events.on('isa95-node-merged', this.onMerged);
    await this.isa95.start();
  },

  computed: {
    rows() {
      return this.isa95.data.map(n => ({
        ...n,
        parents: this.isa95.parents_of(n.uuid).map(p => p.name),
      }));
    },
    filters() {
      return [{
        name: 'Level',
        property: 'level',
        options: ISA95_LEVELS.map(l => ({ label: l, value: l })),
      }];
    },
    initialSort() {
      return [{
        id: 'level',
        desc: false
      }]
    },
    /* Resolve the selection from the store so it stays live after edits. */
    selectedNode() {
      if (!this.selectedUuid) return null;
      return this.isa95.by_uuid(this.selectedUuid) ?? null;
    },
    /* The nodes above the selected one, whose grants also cover it. */
    selectedVia() {
      return isa95_path(this.isa95.data, this.selectedUuid).slice(0, -1);
    },
    parentNames() {
      const parents = this.isa95.parents_of(this.selectedUuid).map(p => p.name);
      return parents.length ? parents.join(', ') : 'None';
    },
    aliasNames() {
      return this.selectedNode.aliases.length ? this.selectedNode.aliases.join(', ') : 'None';
    },
    childNames() {
      const children = this.isa95.children_of(this.selectedUuid).map(c => c.name);
      return children.length ? children.join(', ') : 'None';
    },
  },

  methods: {
    nodeClick(node) {
      this.selectedUuid = node?.uuid ?? null;
    },
    newNode() {
      window.events.emit('show-new-isa95-node-dialog')
    },
    editNode() {
      window.events.emit('show-new-isa95-node-dialog', this.selectedNode)
    },
    importPlacements() {
      window.events.emit('show-isa95-placement-import-dialog')
    },
    mergeNode() {
      window.events.emit('show-isa95-merge-dialog', this.selectedNode)
    },
    /* After a merge the selected node is gone; show the one it went into. */
    onMerged(uuid) {
      this.selectedUuid = uuid ?? null;
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
      const placements = new Map(this.d.data.map(d => [d.uuid, d.placement]));
      const placed = devices_placed_under(this.isa95.vocabulary, placements, node.uuid);
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
            this.selectedUuid = null;
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
    window.events.off('isa95-node-merged', this.onMerged);
    this.isa95.stop();
  }
}
</script>

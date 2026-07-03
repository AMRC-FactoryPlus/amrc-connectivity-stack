<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Tabs v-model="activeTab">
    <div class="flex items-center justify-between gap-2 mb-6">
      <div class="flex gap-2 items-center">
        <TabsList>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
        </TabsList>
        <div v-if="da.loading">
          <i class="fa-solid fa-circle-notch animate-spin text-gray-400"></i>
        </div>
      </div>
      <Button v-if="activeTab === 'structure'" class="gap-2" @click="new_dataset">
        <i class="fa-solid fa-plus"></i>
        <span>New Dataset</span>
      </Button>
    </div>

    <!-- ─── DATASETS TAB (metadata / read access) ─── -->
    <TabsContent value="datasets">
      <div class="flex h-[calc(100vh-160px)]">
        <div class="flex-1 overflow-auto pr-4">
          <Skeleton v-if="!da.ready" v-for="i in 8" :key="i" class="h-16 rounded-lg mb-2"/>
          <DataTableSearchable v-else
            :columns="metadataColumns"
            :data="da.datasets"
            :limit-height="false"
            :clickable="true"
            :filters="[]"
            :selected-objects="[]"
            :default-sort="initialSort"
            @row-click="e => select_dataset(e.original)"
          >
            <template #empty>
              <EmptyState
                title="No Datasets"
                description="No datasets are accessible to you. Datasets appear here once you have Read permission on them."
              />
            </template>
          </DataTableSearchable>
        </div>

        <!-- Metadata sidebar -->
        <div v-if="selectedDataset.uuid" class="w-96 border-l border-border flex-shrink-0 overflow-y-auto">
          <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
            <div class="flex items-center gap-2">
              <i class="fa-fw fa-solid fa-database"></i>
              <div class="font-semibold text-xl">Dataset</div>
            </div>
            <Button
              title="Download data"
              size="xs"
              variant="outline"
              class="flex gap-1"
              :disabled="downloading"
              @click="download_dataset(selectedDataset.uuid)"
            >
              <i v-if="!downloading" class="fa-solid fa-download text-gray-600"></i>
              <i v-else class="fa-solid fa-circle-notch animate-spin text-gray-400"></i>
              <span class="text-xs">{{ downloading ? 'Downloading…' : 'Download' }}</span>
            </Button>
          </div>
          <div class="space-y-4 p-4">
            <SidebarDetail icon="key"       label="UUID"  :value="selectedDataset.uuid"/>
            <SidebarDetail icon="tag"       label="Name"  :value="selectedDataset.name ?? '—'"/>
            <SidebarDetail icon="calendar-day" label="From" :value="selectedDataset.from ? formatDate(selectedDataset.from) : 'Unbounded'"/>
            <SidebarDetail icon="calendar-check" label="To" :value="selectedDataset.to ? formatDate(selectedDataset.to) : 'Unbounded'"/>
            <div v-if="selectedDataset.function?.length">
              <div class="text-xs text-gray-500 mb-1">Functional Classes</div>
              <div v-for="cls in selectedDataset.function" :key="cls" class="text-xs font-mono text-gray-700">{{ cls }}</div>
            </div>
            <div v-if="selectedDataset.parts?.length">
              <div class="text-xs text-gray-500 mb-1">Parts ({{ selectedDataset.parts.length }})</div>
              <div v-for="part in selectedDataset.parts" :key="part" class="text-xs font-mono text-gray-700 truncate">{{ part }}</div>
            </div>
          </div>
        </div>
        <div v-else class="w-96 border-l border-border flex-shrink-0 flex items-center justify-center text-gray-400">
          <p class="text-sm">Select a dataset to view details</p>
        </div>
      </div>
    </TabsContent>

    <!-- ─── STRUCTURE TAB (edit access) ─── -->
    <TabsContent value="structure">
      <div class="flex h-[calc(100vh-160px)]">
        <div class="flex-1 overflow-auto pr-4">
          <Skeleton v-if="!da.ready" v-for="i in 8" :key="i" class="h-16 rounded-lg mb-2"/>
          <DataTableSearchable v-else
            :columns="structureColumns"
            :data="structuresWithNames"
            :limit-height="false"
            :clickable="true"
            :filters="[]"
            :selected-objects="[]"
            :default-sort="initialSort"
            @row-click="e => select_structure(e.original)"
          >
            <template #empty>
              <EmptyState
                title="No Editable Datasets"
                description="No datasets are editable by you. Create a new dataset or request Edit permission on existing ones."
                button-text="New Dataset"
                button-icon="plus"
                @button-click="new_dataset"
              />
            </template>
          </DataTableSearchable>
        </div>

        <!-- Structure sidebar -->
        <div v-if="selectedStructure.uuid" class="w-96 border-l border-border flex-shrink-0 overflow-y-auto">
          <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
            <div class="flex items-center gap-2">
              <i class="fa-fw fa-solid fa-sitemap"></i>
              <div class="font-semibold text-xl">Structure</div>
            </div>
            <div class="flex items-center gap-1">
              <Button
                title="Download data"
                size="xs"
                variant="ghost"
                :disabled="downloading"
                @click="download_dataset(selectedStructure.uuid)"
              >
                <i v-if="!downloading" class="fa-solid fa-download text-gray-500"></i>
                <i v-else class="fa-solid fa-circle-notch animate-spin text-gray-400"></i>
              </Button>
              <Button title="Edit dataset" size="xs" variant="ghost" @click="edit_dataset(selectedStructure)">
                <i class="fa-solid fa-pen text-gray-500"></i>
              </Button>
              <Button title="Delete dataset" size="xs" variant="ghost" @click="delete_dataset(selectedStructure)">
                <i class="fa-solid fa-trash text-red-400"></i>
              </Button>
            </div>
          </div>
          <div class="space-y-4 p-4">
            <SidebarDetail icon="key"     label="UUID"      :value="selectedStructure.uuid"/>
            <SidebarDetail icon="tag"     label="Name"      :value="selectedStructure.name ?? '—'"/>
            <SidebarDetail icon="shapes"  label="Type"      :value="structure_label(selectedStructure.structure)"/>
            <div v-if="selectedStructure.config !== undefined">
              <div class="text-xs text-gray-500 mb-1">Configuration</div>
              <pre class="text-xs bg-gray-50 border rounded p-2 overflow-auto max-h-48">{{ JSON.stringify(selectedStructure.config, null, 2) }}</pre>
            </div>
          </div>
        </div>
        <div v-else class="w-96 border-l border-border flex-shrink-0 flex items-center justify-center text-gray-400">
          <p class="text-sm">Select a dataset to view structure</p>
        </div>
      </div>
    </TabsContent>
  </Tabs>

  <NewDatasetDialogTest ref="newDatasetDialog" @saved="on_dataset_saved"/>
</template>

<script>
import { ref } from 'vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import DataTableSearchable from '@components/ui/data-table-searchable/DataTableSearchable.vue'
import SidebarDetail from '@components/SidebarDetail.vue'
import EmptyState from '@components/EmptyState.vue'
import { useDataAccessStore } from '@store/useDataAccessStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog'
import { toast } from 'vue-sonner'
import { metadataColumns, structureColumns, structure_label } from './datasetColumns.ts'
import NewDatasetDialog from '@components/DataAccess/NewDatasetDialog.vue'
import NewDatasetDialogTest from '@components/DataAccess/NewDatasetDialogTest.vue'
import streamSaver from 'streamsaver'

function formatDate (dateStr) {
    if (!dateStr) return '—'
    try {
        return new Date(dateStr).toLocaleString()
    } catch {
        return dateStr
    }
}

export default {
    name: 'DataAccess',

    components: {
        Tabs, TabsContent, TabsList, TabsTrigger,
        Button, Skeleton,
        DataTableSearchable, SidebarDetail, EmptyState,
        NewDatasetDialog,
        NewDatasetDialogTest
    },

    setup () {
        return {
            activeTab: ref('datasets'),
            selectedDataset: ref({}),
            selectedStructure: ref({}),
            downloading: ref(false),
            da: useDataAccessStore(),
            s: useServiceClientStore(),
            metadataColumns,
            structureColumns,
            structure_label,
        }
    },

    async mounted () {
        await this.da.start()
    },

    async unmounted () {
        this.da.stop()
    },

    computed: {
        initialSort () {
            return [{ id: 'name', desc: false }]
        },

        structuresWithNames () {
            return this.da.structures.map(s => ({
                ...s,
                name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
            }))
        },
    },

    methods: {
        formatDate,

        select_dataset (dataset) {
            this.selectedDataset = dataset ?? {}
        },

        select_structure (structure) {
            this.selectedStructure = structure ?? {}
        },

        new_dataset () {
            this.$refs.newDatasetDialog.open(null)
        },

        edit_dataset (existingDataset) {
            this.$refs.newDatasetDialog.open(existingDataset)
        },

        delete_dataset (dataset) {
            const name = dataset.name ?? dataset.uuid
            useDialog({
                title: 'Delete Dataset',
                message: `Are you sure you want to delete the dataset "${name}"? This action cannot be undone.`,
                confirmText: 'Delete',
                onConfirm: async () => {
                    try {
                        await this.s.client.DataAccess.delete_dataset(dataset.uuid)
                        toast.success('Dataset deleted')
                        if (this.selectedStructure.uuid === structure.uuid) {
                            this.selectedStructure = {}
                        }
                    } catch (err) {
                        console.error('Failed to delete dataset:', err)
                        toast.error('Failed to delete dataset', {
                            description: err.message ?? 'An unexpected error occurred',
                        })
                    }
                },
            })
        },

        async download_dataset (uuid) {
            if (!uuid || this.downloading) return
            this.downloading = true
            try {
                const [st, stream, , headers] = await this.s.client.DataAccess.fetch({
                    url: `v1/data/${uuid}`,
                    method: 'POST',
                    accept: 'application/zip',
                    response_type: 'stream',
                    body: {},
                })

                if (st === 403) {
                    toast.error('Not authorised to download this dataset')
                    return
                }
                if (st !== 200) {
                    toast.error(`Download failed (HTTP ${st})`)
                    return
                }

                const disposition = headers?.get?.('Content-Disposition') ?? ''
                const filename =
                    /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(disposition)?.[2]
                    ?? `${uuid}.zip`

                const fileStream = streamSaver.createWriteStream(filename)
                if (window.WritableStream && stream.pipeTo) {
                    await stream.pipeTo(fileStream)
                } else {
                    const writer = fileStream.getWriter()
                    const reader = stream.getReader()
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        await writer.write(value)
                    }
                    await writer.close()
                }
                toast.success('Download complete')
            } catch (err) {
                console.error('Download error:', err)
                toast.error('Download failed', {
                    description: err.message ?? 'An unexpected error occurred',
                })
            } finally {
                this.downloading = false
            }
        },

        on_dataset_saved () {
            this.selectedStructure = {}
        },
    },
}
</script>

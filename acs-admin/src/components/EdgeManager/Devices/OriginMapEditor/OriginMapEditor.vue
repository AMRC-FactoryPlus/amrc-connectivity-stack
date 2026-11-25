<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <!-- Wrapper div with fixed height and no scrolling -->
  <div class="w-full overflow-hidden flex-1 relative">
    <SidebarProvider class="overflow-hidden">
      <!-- Edge Scout bulk mapping and the picker a driver UI opens -->
      <ScoutMapDialog :open="mapOpen" :items="mapItems" :schema="schema" :index="scout.current_index.value"
          :model="model" @apply="applyScoutMap" @close="mapOpen = false"/>
      <ScoutPicker :open="picker.open" :index="scout.current_index.value" :filter="picker.filter"
          @pick="item => closePicker(item)" @close="closePicker(null)"/>
      <Dialog :open="!!newObjectContext" @update:open="(open) => { if (!open) newObjectContext = null }">
        <DialogContent class="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle v-if="newObjectContext && newObjectContext.length">
              Add a new entry to {{ newObjectContext[0].key }}
            </DialogTitle>
            <DialogDescription>Create a new item in this section</DialogDescription>
          </DialogHeader>
          <NewObjectOverlayForm
              @create="createObject"
              @close="newObjectContext = null"
              v-if="newObjectContext && newObjectContext[newObjectContext.length-1]?.value?.patternProperties"
              :object-type="newObjectContext && newObjectContext.length ? newObjectContext[0].key : 'Object'"
              :regex="Object.keys(newObjectContext[newObjectContext.length-1]?.value?.patternProperties || {})[0] || '.*'"></NewObjectOverlayForm>
        </DialogContent>
      </Dialog>
      <Dialog :open="csvDialogOpen" @update:open="(open) => { if (!open) { csvDialogOpen = false; csvParsedData = null } }">
        <DialogContent class="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <TriangleAlert class="size-5 text-amber-500" />
              Import CSV
            </DialogTitle>
            <DialogDescription>
              This will overwrite all current metric values in the origin map with values from the CSV file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="flex gap-2 sm:justify-start">
            <Button variant="destructive" @click="handleCsvSave">
              Save
            </Button>
            <Button variant="outline" @click="handleCsvReview">
              Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <!-- Sidebar with fixed height and independent scrolling -->
      <Sidebar collapsible="none" class="flex flex-col ml-3 my-3 bg-gray-100/50 border rounded-lg">
        <SidebarContent class="flex flex-col h-auto">
          <!-- Schema tree with independent scrolling -->
          <SidebarGroup class="h-auto overflow-hidden flex-1">
            <SidebarGroupContent class="overflow-auto h-auto">
              <SidebarMenu>
                <SchemaGroup v-if="schema" :key="groupRerenderTrigger"
                    @selected="selectMetric"
                    @dropItem="onScoutDrop"
                    @newObject="newObject"
                    @deleteObject="maybeDeleteObject"
                    @toggle-show-only-populated="handleToggleShowOnlyPopulated"
                    class="overflow-x-auto border-l-0"
                    :schema="schema"
                    :selected-metric="selectedMetric"
                    :model="model"
                    :show-only-populated="showOnlyPopulated">
                </SchemaGroup>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <!-- Save button fixed at the bottom -->
          <Button v-if="canSave" variant="destructive" :disabled="loading" @click="save()" class="mt-2 shrink-0 mx-3 mb-1">
            <div v-if="!loading" class="flex items-center justify-center gap-1">
              <span>Save Changes</span>
              <i class="fa-sharp fa-solid fa-save ml-2"></i>
            </div>
            <div v-else class="flex items-center justify-center gap-1">
              <span>Saving</span>
              <i class="fa-sharp fa-solid fa-circle-notch fa-spin ml-2"></i>
            </div>
          </Button>
          <!-- CSV Import/Export buttons -->
          <!-- <div class="flex gap-2 mx-3 mb-3"> -->
            <Button variant="outline" class="shrink-0 mx-3" @click="handleDownloadCsv" :disabled="!schema">
              <Download class="size-4 mr-1" />
              Download CSV
            </Button>
            <Button v-if="canSave" variant="outline" class="shrink-0 mx-3 mt-1 mb-2" @click="$refs.csvFileInput.click()" :disabled="!schema">
              <Upload class="size-4 mr-1" />
              Upload CSV
            </Button>
          <!-- </div> -->

          <input
            ref="csvFileInput"
            type="file"
            accept=".csv"
            class="hidden"
            @change="handleCsvFileSelected"
          />
        </SidebarContent>
        <SidebarRail/>
      </Sidebar>
      <!-- Main content with fixed height and independent scrolling -->
      <!-- The metric pane is a size container named `pane`, so the header
         - and the metric fields follow its width and not the window's. The
         - Addresses panel takes width from it without the window changing. -->
      <SidebarInset class="@container/pane flex flex-col flex-1 overflow-auto px-6 py-4 h-full">
        <!-- Fixed header. The description sits under the metric name, and
           - on a narrow pane the buttons show only their icons, with the
           - label as a tooltip. Buttons in the actions slot do the same
           - with `hidden @3xl/pane:inline` on their label. -->
        <header class="flex shrink-0 items-start justify-between gap-3 px-1 mb-3">
          <div class="min-w-0 flex-1">
            <Breadcrumb>
              <BreadcrumbList>
                <template v-if="selectedMetric">
                  <template v-for="(segment, index) in selectedMetric.path.slice(0, -1)" :key="index">
                    <BreadcrumbItem class="hidden @2xl/pane:block">
                      <BreadcrumbLink>
                        {{segment}}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator class="hidden @2xl/pane:block"/>
                  </template>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{{selectedMetric.path.slice(-1)[0]}}</BreadcrumbPage>
                  </BreadcrumbItem>
                </template>
              </BreadcrumbList>
            </Breadcrumb>
            <p v-if="selectedMetric?.model.Documentation"
                class="mt-1 text-xs text-gray-400 line-clamp-2"
                :title="selectedMetric.model.Documentation">{{selectedMetric.model.Documentation}}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <slot name="actions"/>
            <!-- Edge Scout: the discovered addresses of this connection -->
            <Button v-if="scoutVisible" variant="outline" size="sm" class="gap-2"
                :aria-pressed="scoutOpen" :aria-expanded="scoutOpen"
                title="Addresses: the device's addresses from the last scan"
                aria-label="Addresses"
                @click="toggleScout()">
              <i class="fa-solid fa-sitemap text-sm"></i>
              <span class="hidden @3xl/pane:inline">Addresses</span>
              <span v-if="scoutCount != null" class="rounded-full bg-gray-100 px-1.5 text-xs text-gray-600">
                {{ scoutCount.toLocaleString('en-GB') }}
              </span>
            </Button>
          </div>
        </header>
        <!-- Scrollable content area -->
        <div class="flex-1 content-scroll">
        <div v-if="selectedMetric">
          <!-- What the last scan says about this metric's address -->
          <div v-if="selectedScanStatus?.status === 'missing'"
              class="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            Not found in the scan of {{ scanWhen }}.
          </div>
          <div v-else-if="selectedScanStatus?.conflict"
              class="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            The scan found this address as {{ selectedScanStatus.item.type }}, but the metric's type is
            {{ selectedMetric.model.Sparkplug_Type }}.
          </div>
          <SparkplugMetric :key="rerenderTrigger"
              :selected-metric="selectedMetric" :model="model"
              :schema="sparkplugMetricSchema.schema"
              :connection="device.deviceInformation?.connection"
              :can-pick="scoutVisible && !!scout.status.value?.current"
              @pick-from-scan="pickFromScan"
              @input="metricDetailsEdited"
              @remove-metric="removeMetric">
          </SparkplugMetric>
        </div>
        <div v-else class="flex items-center justify-center h-full">
          <div class="text-center">
            <i class="fas fa-tag fa-2x text-gray-500"></i>
            <h3 class="mt-2 text-sm font-medium text-gray-700">No Metric Selected</h3>
            <p class="mt-1 text-sm text-gray-400">Click on a metric on the left to configure it.</p>
          </div>
        </div>
      </div>
    </SidebarInset>

    <!-- Edge Scout: the Addresses panel. Resizable on wide screens, and a
       - sheet over the metric pane below lg. On wide screens it never
       - takes so much that the schema tree (16rem) and a 24rem metric pane
       - no longer fit beside it. Pop out moves the same panel
       - into a large dialog over the page, for deep trees. Teleport moves
       - it without remounting, so the open folders and search stay. -->
    <Teleport to="body" :disabled="!scoutExpanded">
    <div v-if="scoutVisible && scoutOpen && scoutExpanded"
        class="fixed inset-0 z-50 bg-black/40" aria-hidden="true" @click="scoutExpanded = false"></div>
    <aside v-if="scoutVisible && scoutOpen"
        :class="scoutExpanded
          ? 'fixed inset-4 z-50 flex shadow-2xl md:inset-8'
          : 'absolute inset-y-0 right-0 z-20 flex shadow-xl lg:static lg:z-auto lg:shadow-none my-3 mr-3 shrink-0 max-w-[calc(100%-1.5rem)] lg:max-w-[max(20rem,calc(100%-41rem))]'"
        :style="scoutExpanded ? null : { width: `${scoutWidth}px` }"
        :role="scoutExpanded ? 'dialog' : null"
        :aria-modal="scoutExpanded ? 'true' : null"
        aria-label="Addresses"
        @keydown.esc="scoutExpanded = false">
      <div v-if="!scoutExpanded" class="hidden lg:block w-1.5 shrink-0 cursor-col-resize hover:bg-gray-300 rounded"
          role="separator" aria-orientation="vertical" aria-label="Resize the Addresses panel"
          tabindex="0"
          @mousedown.prevent="startResize"
          @keydown.left.prevent="resizeBy(24)" @keydown.right.prevent="resizeBy(-24)"></div>
      <div class="flex-1 min-w-0 flex flex-col border rounded-lg p-3"
          :class="scoutExpanded ? 'bg-white' : 'bg-white lg:bg-gray-50'">
        <ScoutPanel ref="scoutPanel"
            :scout="scout" :driver="driverDef" :driver-name="driverName" :kind="scoutKind"
            :model="model" :devices="scoutDevices" :selected-metric="selectedMetric"
            :pick-for="scoutPickFor ? scoutPickFor.join(' / ') : null"
            :popped-out="scoutExpanded"
            @use="useScoutItem" @map="openScoutMap" @close="toggleScout(false)"
            @pop-out="v => scoutExpanded = v"
            @cancel-pick="scoutPickFor = null"
            @select-metric="selectMetricByPath"/>
      </div>
    </aside>
    </Teleport>
  </SidebarProvider>
  </div>
</template>
<script>
import { v4 as uuidv4 } from 'uuid'
import { useSchemaStore } from '@store/useSchemaStore.js'
import SchemaGroup from './SchemaGroup.vue'
import SparkplugMetric from './SparkplugMetric.vue'
import { dereference } from '@/utils/jsonSchemaRefParserWrapper';
import { storeReady } from '@store/useStoreReady.js'
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useConnectionStore } from '@store/useConnectionStore.js'
import _ from 'lodash'
import NewObjectOverlayForm from './NewObjectOverlayForm.vue'
import { updateEdgeAgentConfig } from '@/utils/edgeAgentConfigUpdater'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { generateCsv, downloadCsv, parseCsv, applyCsvToModel } from '@/composables/useOriginMapCsv.js'
import { csv_unit_problems } from '@/lib/eng-units.js'
import { useEngUnitStore } from '@store/useEngUnitStore.js'
import Papa from 'papaparse'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar'
import { Download, File, TriangleAlert, Upload } from 'lucide-vue-next'
import Tree from './Tree.vue'
import { useAccessStore } from '@store/useAccessStore.js'
import { can_edit_device_ea } from '@/lib/access/perms-edge.js'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import ScoutPanel from './Scout/ScoutPanel.vue'
import ScoutMapDialog from './Scout/ScoutMapDialog.vue'
import ScoutPicker from './Scout/ScoutPicker.vue'
import { useScout } from '@/composables/useScout.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useDriverStore } from '@store/useDriverStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { apply_item, ensure_metric, schema_chain, set_at, value_at } from '@/lib/scout/ensure-metric.js'
import { bulk_rows, is_split_driver, metric_status, proposal_for_item, when_text } from '@/lib/scout/model.js'
import { apply_proposal, ui_version, validate_proposal } from '@/lib/driver-ui/contract.js'
import { EdgeSim } from '@/lib/edge-sim-uuids.js'
import { computed, ref } from 'vue'

/* Width of the Addresses panel, remembered per browser. */
const SCOUT_WIDTH_KEY = 'scoutPanelWidth'
const SCOUT_WIDTH_MIN = 320
const SCOUT_WIDTH_MAX = 1400

const SparkplugMetricUUID = 'b16275f1-e443-4c41-a482-fcbdfbd20769'
export default {

  setup (props) {
    const conn = useConnectionStore()
    const nodes = useNodeStore()

    const connection = computed(() => conn.data.find(c => c.uuid === props.device?.deviceInformation?.connection) ?? null)
    const driverDef = computed(() => connection.value?.configuration?.driver ?? null)
    const nodeAddress = computed(() => {
      const addr = nodes.data.find(n => n.uuid === props.device?.deviceInformation?.node)?.sparkplugAddress
      return addr?.group_id && addr?.node_id ? `${addr.group_id}/${addr.node_id}` : null
    })

    /* The panel opens on demand. A version 2 driver UI needs the scan as
     * well, to answer pick-address and scout-query. */
    const scoutOpen = ref(false)
    const scoutActive = computed(() => scoutOpen.value || ui_version(driverDef.value) >= 2)

    const scout = useScout({
      node: () => props.device?.deviceInformation?.node ?? null,
      connection: () => props.device?.deviceInformation?.connection ?? null,
      address: nodeAddress,
      driver: driverDef,
      active: scoutActive,
    })

    return {
      sch: useSchemaStore(),
      s: useServiceClientStore(),
      conn,
      access: useAccessStore(),
      nodes,
      drivers: useDriverStore(),
      devices: useDeviceStore(),
      units: useEngUnitStore(),
      scout,
      scoutOpen,
      connectionInfo: connection,
      driverDef,
    }
  },

  /* Edge Scout access for a version 2 driver UI (DriverCustomUI.vue).
   * The functions read live state, so the frame always sees the current
   * scan. */
  provide () {
    return {
      driverUiScout: {
        summary: () => this.scout.summary.value,
        index: () => this.scout.current_index.value,
        pick: filter => this.openPicker(filter),
      },
    }
  },

  props: {
    device: { required: true },
    deviceSchema: {
      required: true,
      type: Object,
    },
  },

  components: {
    SchemaGroup,
    SparkplugMetric,
    Button,
    NewObjectOverlayForm,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Upload,
    Download,
    TriangleAlert,
    SidebarHeader,
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    Separator,
    File,
    Tree,
    ScoutPanel,
    ScoutMapDialog,
    ScoutPicker,
  },

  mounted () {
    // Prevent the window from reloading if we have a dirty state
    window.onbeforeunload = this.checkDirty

    document.addEventListener('keydown', this.doSave)

    // Load the showOnlyPopulated preference from localStorage
    const savedShowOnlyPopulated = localStorage.getItem('showOnlyPopulated');
    if (savedShowOnlyPopulated !== null) {
      this.showOnlyPopulated = savedShowOnlyPopulated === 'true';
    }

    // Start the connection store
    this.conn.start()

    // The node, driver and device stores, for the Addresses panel
    this.nodes.start()
    this.drivers.start()
    this.devices.start()

    try {
      const width = Number(localStorage.getItem(SCOUT_WIDTH_KEY))
      if (width) this.scoutWidth = Math.min(SCOUT_WIDTH_MAX, Math.max(SCOUT_WIDTH_MIN, width))
    }
    catch {
      /* Storage can be unavailable, and the default width stands. */
    }

    // The unit vocabulary, to check units in a CSV import
    useEngUnitStore().start()
  },

  computed: {
    /* Saving patches DeviceInformation and rewrites the Edge Agent
     * config. Without that the map is still there to read. */
    canSave () {
      return can_edit_device_ea(this.access.check)
    },

    sparkplugMetricSchema () {
      return this.sch.data.find(e => e.uuid === SparkplugMetricUUID)
    },

    /* The panel shows for every split driver connection unless its
     * DriverDef says `scout: false`. A driver with no `scout` key gets it,
     * and its hello says whether it can scan. A built-in driver has no
     * split DriverDef, and the agent cannot ask it to scan. */
    scoutVisible () {
      return !!this.device?.deviceInformation?.connection
        && is_split_driver(this.driverDef)
        && this.driverDef.scout !== false
    },

    scoutCount () {
      return this.scout.status.value?.current?.items ?? null
    },

    driverName () {
      const uuid = this.connectionInfo?.configuration?.driver_uuid
      return this.drivers.data.find(d => d.uuid === uuid)?.name ?? null
    },

    scoutKind () {
      if (this.connectionInfo?.configuration?.driver_uuid === EdgeSim.Driver) return 'sim'
      return this.driverDef?.scout?.address_form === 'mqtt' ? 'mqtt' : null
    },

    /* Every device on this connection, for "mapped to" and the Not
     * mapped filter. This device uses the editor's live model, so unsaved
     * mappings count. */
    scoutDevices () {
      const conn = this.device?.deviceInformation?.connection
      const others = this.devices.data
        .filter(d => d.uuid !== this.device.uuid && d.deviceInformation?.connection === conn)
        .map(d => ({ name: d.name, model: d.deviceInformation?.originMap ?? {} }))
      return [{ name: this.device.name ?? 'This device', model: this.model }, ...others]
    },

    selectedScanStatus () {
      const index = this.scout.current_index.value
      const meta = this.scout.status.value?.current
      if (!index || !meta || !this.selectedMetric) return null
      return metric_status(this.selectedMetric.model, index, meta,
        this.driverDef?.scout?.address_form ?? 'exact')
    },

    scanWhen () {
      return when_text(this.scout.status.value?.current?.finished)
    },
  },
  /* `scout-open` tells the device page the Addresses panel opened or
   * closed, so the page can give the panel its info sidebar's width. */
  emits: ['scout-open'],

  watch: {
    scoutOpen (open) {
      this.$emit('scout-open', open && this.scoutVisible)
    },

    // If the schema changes (including on load), build up the schema
    // and load the existing config
    'deviceSchema.uuid': {
      immediate: true,
      async handler(schemaUuid) {
        if (schemaUuid) {
          try {
            console.debug('Looking for schema', `urn:uuid:${schemaUuid}`)
            // Remove the "urn:uuid:" prefix here since dereference will add it
            this.schema = await this.dereference(schemaUuid)
            this.loadExistingConfig()
          }
          catch (error) {
            console.error('Failed to resolve schema:', error)
          }
        }
      }
    },

    // Watch for changes to the origin map in device information
    'device.deviceInformation.originMap': {
      immediate: true,
      handler(newOriginMap) {
        console.debug('Origin map changed:', newOriginMap)
        if (newOriginMap === null || newOriginMap === undefined) {
          console.debug('Resetting origin map model')
          this.resetModel()
          this.groupRerenderTrigger = +new Date()
        } else if (!this.isDirty) {
          // Accept external updates (e.g. from the ISA-95 sidebar panel)
          // when there are no unsaved local changes in the editor.
          this.model = newOriginMap
          this.groupRerenderTrigger = +new Date()
        }
      }
    }
  },

  beforeDestroy () {
    document.removeEventListener('keydown', this.doSave)
  },

  beforeUnmount () {
    this.scout.stop()
    this.closePicker(null)
    this.stopResize()
  },

  methods: {

    async dereference (schemaUuid) {
      const parser = {
        order: 1,
        canParse: true,
        parse: file => file.data,
      }

      const resolver = {
        order: 1,
        canRead: /^urn:uuid\/?:[-0-9a-f]{36}$/,
        read: async (file) => {
          console.debug('Reading file', file.url)
          const uuid = file.url.replace(/^urn:uuid\/?:/, '')
          console.debug('Waiting for schema store to be ready...')
          await storeReady(this.sch)
          console.debug('Schema store is ready')
          console.debug('Looking for schema in store', uuid)
          const found = this.sch.data.find(s => s.uuid === uuid)
          console.debug('Found schema', found)
          return found.schema
        },
      }

      // Remove the prefix if it's already there
      const cleanUuid = schemaUuid.replace(/^urn:uuid:/, '')
      return await dereference(`urn:uuid:${cleanUuid}`, {
        parse: { all: parser },
        resolve: {
          uuid: resolver,
          file: false,
          http: false,
        },
      })
    },

    checkDirty () {
      if (this.isDirty) {
        return ''
      }
    },

    loadExistingConfig () {

      this.loadingExistingConfig = true

      if (!this.device.deviceInformation.originMap) {
        // Reset the model to an empty object if there's no origin map
        this.resetModel()
        this.loadingExistingConfig = false
        return
      }

      // Load the model
      this.model = this.device.deviceInformation.originMap

      // Iterate through the model and create schema objects where they don't yet exist
      this.updateDynamicSchemaObjects()

      this.loadingExistingConfig = false
    },

    updateDynamicSchemaObjects () {

      /** This method goes through the model recursively and looks for
       * Schema_UUIDs. If it finds one it works out where it was found
       * and checks the relative place in the Schema object to see if
       * it's the child of a regex. If it is then it won't have the
       * required schema objects populated so we need to create them.
       * */

        // The nestingPointer array is used to keep track of where we are in the model
      let nestingPointer = []
      this.searchForSchemaUUID(this.model, nestingPointer)

    },

    selectSchema (schema) {
      this.schema                = schema.parsedSchema
      this.loadingExistingConfig = false
    },

    searchForSchemaUUID (modelLevel, nestingPointer) {
      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.

      let n = nestingPointer.slice(0, -1).flatMap(e => ['properties', e])

      // Get the last element of the nestingPointer which will be the name of the object to create
      let objectName = nestingPointer[nestingPointer.length - 1]

      if (// Make sure modelLevel is an object
        modelLevel && typeof modelLevel === 'object' &&
        // If we have a Schema_UUID in here then create it first to avoid child before parent issues
        Object.keys(modelLevel).includes('Schema_UUID')

        // Do not process this if it's a metric schema
        && modelLevel.Schema_UUID !== SparkplugMetricUUID

        // Do not process this if it's already been added to the schema object
        && !_.get(this.schema, n.join('.') + '.properties.' + objectName)) {

        // Work out what the object looks like for this model in the schema
        let nestedProperty = n.reduce((object, key) => object && object[key], this.schema)

        // If the nestedProperty exists and has patternProperties then we need to create the schema objects
        if (nestedProperty && nestedProperty.patternProperties) {

          // Get the first key within nestedProperty.patternProperties that will be the regex
          let patternProps = nestedProperty.patternProperties || {}
          let regexKey = Object.keys(patternProps)[0]

          // Get the content of that schema, which will be the object that we need to create
          let schemaToInstantiate = regexKey ? _.cloneDeep(nestedProperty.patternProperties[regexKey]) : {}

          // Only call removePropertiesWithPatternProperties if properties exists
          if (schemaToInstantiate && schemaToInstantiate.properties) {
            this.removePropertiesWithPatternProperties(schemaToInstantiate.properties)
          }

          // console.debug('PatternProperties found. Creating', schemaToInstantiate.title, 'called', objectName, 'at',
          //     n.join('.'), schemaToInstantiate)

          // Only create the object if we have a valid schema to instantiate
          if (schemaToInstantiate && Object.keys(schemaToInstantiate).length > 0) {
            // Create the object
            this.set(n.join('.') + '.properties.' + objectName, schemaToInstantiate, this.schema, '.')
            this.markDirty()
          }

        }

      }

      // Make sure modelLevel is an object before iterating
      if (modelLevel && typeof modelLevel === 'object') {
        Object.keys(modelLevel).forEach(key => {

        if (key === 'Schema_UUID') {
          // We've already handled this above
          return
        }

        if (typeof modelLevel[key] === 'object') {
          // We've found an object so we need to go deeper
          nestingPointer.push(key)
          this.searchForSchemaUUID(modelLevel[key], nestingPointer)
          nestingPointer.pop()
        }
      })
      }
    },

    removePropertiesWithPatternProperties (obj) {
      if (typeof obj !== 'object' || obj === null) {
        return
      }

      if (obj.properties && obj.patternProperties) {
        delete obj.properties
      }

      for (const key in obj) {
        if (key !== 'properties') {
          this.removePropertiesWithPatternProperties(obj[key])
        }
      }
    },

    doSave (e) {
      if (!((e.keyCode === 83 && e.metaKey) || (e.keyCode === 83 && e.ctrlKey))) {
        return
      }

      e.preventDefault()
      this.save()
    },

    /**
     * This function takes the old CDS metric names and remaps them into ones understood by this schema editor.
     * It also checks that the Sparkplug type is valid and utilises the default if not.
     */
    renameKeys (e) {
      return {
        Address: e.metric.address ?? null,
        Deadband: e.metric.deadBand ?? null,
        Documentation: e.metric.docs ?? null,
        Eng_High: e.metric.engHigh ?? null,
        Eng_Low: e.metric.engLow ?? null,
        Eng_Unit: e.metric.engUnit ?? null,
        Method: e.metric.method ?? null,
        Path: e.metric.path ?? null,
        Record_To_Historian: e.metric.recordToDB ?? null,
        Sparkplug_Type: this.validateType(this.remapTypes(e.metric.type) ?? null, e),
        Value: e.metric.value ?? null,
      }
    },

    validateType (type, mapping) {

      // Get valid types from the schema
      let validTypes = mapping.schemaMapping.metric.properties.Sparkplug_Type.enum

      if (validTypes.includes(type)) {
        // If the type is valid, return it
        return type
      }
      else {
        // Set the first valid type as the default
        return validTypes[0]
      }
    },

    remapTypes (oldType) {

      switch (oldType) {
      case 'Boolean':
        return 'Boolean'

      case 'uInt8':
        return 'UInt16BE'
      case 'int8':
        return 'UInt16BE'

      case 'uInt16BE':
        return 'UInt16BE'
      case 'uInt16LE':
        return 'UInt16LE'
      case 'int16BE':
        return 'Int16BE'
      case 'int16LE':
        return 'Int16LE'

      case 'uInt32BE':
        return 'UInt32BE'
      case 'uInt32LE':
        return 'UInt32LE'
      case 'int32BE':
        return 'Int32BE'
      case 'int32LE':
        return 'Int32LE'

      case 'uInt64BE':
        return 'UInt64BE'
      case 'uInt64LE':
        return 'UInt64LE'
      case 'int64BE':
        return 'Int64BE'
      case 'int64LE':
        return 'Int64LE'

      case 'FloatBE':
        return 'FloatBE'
      case 'FloatLE':
        return 'FloatLE'

      case 'DoubleBE':
        return 'DoubleBE'
      case 'DoubleLE':
        return 'DoubleLE'

      case 'DateTime':
        return 'DateTime'
      case 'String':
        return 'String'
      case 'uuid':
        return 'UUID'
      case 'dataSet':
        return 'DataSet'
      case 'bytes':
        return 'Bytes'
      case 'file':
        return 'File'
      case 'Unknown':
        return 'Unknown'
      default:
        return 'String'
      }
    },


    newObject (val) {
      this.newObjectContext = [...val].reverse()
    },

    maybeDeleteObject (val) {
      const path = [...val].reverse().map(e => e.key).join('.')

      toast.warning('Delete object?', {
        description: `Are you sure you want to delete ${path}? This action cannot be undone.`,
        duration: 5000,
        closeButton: true,
        pauseOnHover: true,
        action: {
          label: 'Delete',
          onClick: () => {
            try {
              this.deleteObject(val)
              toast.success('Success!', {
                description: 'The object has been deleted successfully.',
                pauseOnHover: true,
              })
            }
            catch (err) {
              console.error('Failed to delete object:', err)
              toast.error('Unable to delete object', {
                description: 'There was a problem deleting the object.',
                pauseOnHover: true,
                action: {
                  label: 'Try again',
                  onClick: () => this.maybeDeleteObject(val),
                },
              })
            }
          }
        }
      })
    },

    deleteObject (val) {

      let deleteObjectContext = [...val].reverse().map(e => e.key)

      // Delete the entry from the model
      let lastKey        = deleteObjectContext.pop()
      let nestedProperty = deleteObjectContext.reduce((object, key) => object[key], this.model)

      // Replace this.$delete with delete operator
      delete nestedProperty[lastKey]

      // Delete the entry from the schema
      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.

      let n = deleteObjectContext.flatMap(e => ['properties', e])

      // Work out what the object looks like for this model in the schema
      let nestedSchemaProperty = n.reduce((object, key) => object[key], this.schema)

      // Replace this.$delete with delete operator
      delete nestedSchemaProperty.properties[lastKey]

      if (Object.keys(nestedSchemaProperty.properties).length === 0) {
        delete nestedSchemaProperty.properties
      }

      this.groupRerenderTrigger = +new Date()
      this.markDirty('Deleted Object')
      this.updateDynamicSchemaObjects()
    },

    /**
     * This function adds a new instance of an object represented in the schema by patternProperties.
     */
    createObject (name) {
      if (!this.newObjectContext || !this.newObjectContext.length) {
        console.error('Cannot create object: newObjectContext is null or empty');
        return;
      }

      const lastContext = this.newObjectContext[this.newObjectContext.length - 1];
      if (!lastContext || !lastContext.value || !lastContext.value.patternProperties) {
        console.error('Cannot create object: invalid context structure');
        return;
      }

      const patternProperties = lastContext.value.patternProperties;
      const regexKeys = Object.keys(patternProperties);
      if (!regexKeys.length) {
        console.error('Cannot create object: no pattern properties found');
        return;
      }

      const regexKey = regexKeys[0];
      const schemaUUID = patternProperties[regexKey]?.properties?.Schema_UUID?.const;
      if (!schemaUUID) {
        console.error('Cannot create object: Schema_UUID not found in pattern properties');
        return;
      }

      // Store the current toggle state from localStorage before making changes
      const toggleStateKey = `toggleState-${this.model.Instance_UUID || 'unknown'}`;
      let currentToggleState = null;
      try {
        const storedState = localStorage.getItem(toggleStateKey);
        if (storedState) {
          currentToggleState = JSON.parse(storedState);
        }
      } catch (e) {
        console.warn('Failed to parse toggle state from localStorage', e);
      }

      // This creates an empty object with Schema_UUID and Instance_UUID set at the specific location
      const path = this.newObjectContext.map(e => e.key).join('.') + '.' + name;
      this.set(path, {
        Schema_UUID: schemaUUID,
        Instance_UUID: uuidv4(),
      }, this.model, '.')

      // Update the model and schema
      this.updateDynamicSchemaObjects()

      // Trigger re-render after a short delay to ensure the DOM has updated
      setTimeout(() => {
        // Ensure the parent section stays expanded
        const parentPath = this.newObjectContext.map(e => e.key).join('.');

        // If we have stored toggle state, make sure the parent path is marked as expanded
        if (currentToggleState) {
          // Find if the parent path exists in the toggle state
          const parentIndex = currentToggleState.findIndex(item => {
            const [itemPath] = item.split(':state=');
            return itemPath === parentPath;
          });

          if (parentIndex !== -1) {
            // Update to ensure it's expanded
            currentToggleState[parentIndex] = `${parentPath}:state=open`;
          } else {
            // Add it as expanded
            currentToggleState.push(`${parentPath}:state=open`);
          }

          // Save back to localStorage
          localStorage.setItem(toggleStateKey, JSON.stringify(currentToggleState));
        }

        // Clear the context and trigger re-render
        this.newObjectContext = null
        this.groupRerenderTrigger = +new Date()
        this.markDirty('New Object')
      }, 50);
    },

    selectMetric (val) {
      const res = this.ensureMetric(val)
      if (!res) return

      this.selectedMetric = {
        path: res.path,
        model: res.metric,
        schema: res.schema,
      }

      // Update the toggle state in localStorage to ensure parent objects are expanded
      // This is done after setting selectedMetric so that the SchemaGroup component can use it
      // to determine which objects should be expanded
      this.ensureParentObjectsExpanded(res.path);

      this.rerenderTrigger = +new Date()
    },

    /**
     * Find the metric for a SchemaGroup chain, creating it with its
     * defaults if the origin map has no entry yet. See
     * lib/scout/ensure-metric.js. The metric returned is the object in
     * this.model, which is what the editor must change in place.
     */
    ensureMetric (chain) {
      const res = ensure_metric({
        model: this.model,
        chain,
        new_uuid: uuidv4,
        set: (path, value) => set_at(this.model, path, value),
      })
      if (!res) {
        console.error(
          'Metric not configured correctly. It must be contained within an allOf and have a second element specifying the Sparkplug type and other overloads. See the Factory+ Schema definition for more information.',
          chain[0]?.value, [...chain].reverse().map(e => e.key).join('.'))
      }
      return res
    },

    selectMetricByPath (path) {
      const chain = this.schema && schema_chain(this.schema, path)
      if (chain) this.selectMetric(chain)
    },

    /* ---- Edge Scout ---- */

    toggleScout (open = !this.scoutOpen) {
      this.scoutOpen = open
      if (!open) {
        this.scoutPickFor = null
        this.scoutExpanded = false
      }
    },

    pickFromScan () {
      if (!this.selectedMetric) return
      this.scoutPickFor = [...this.selectedMetric.path]
      this.scoutOpen = true
    },

    /* Enter, Use, or a click in pick mode. */
    useScoutItem (item) {
      const path = this.scoutPickFor ?? this.selectedMetric?.path
      if (!path) {
        toast.info('Select a metric first', {
          description: 'Or drag the address onto a metric in the schema tree.',
          pauseOnHover: true,
        })
        return
      }
      const chain = schema_chain(this.schema, path)
      if (chain) this.applyScoutItem(item, chain)
      this.scoutPickFor = null
    },

    onScoutDrop (chain, id) {
      const item = this.scout.current_index.value?.by_id.get(id)
      if (item?.kind === 'value') this.applyScoutItem(item, chain)
    },

    /**
     * Fill a metric from a discovered item, selected or not.
     *
     * The values go through the same allowlist and checks as a driver UI
     * proposal, and onto the metric object in place, because the editor
     * identifies metrics by identity. A metric that is not selected has
     * no SparkplugMetric to emit input, so this marks the form dirty and
     * re-renders itself. Nothing is saved until Save.
     */
    applyScoutItem (item, chain) {
      const resolve_unit = this.units.ready ? this.units.resolve : undefined
      const res = apply_item({
        model: this.model,
        chain,
        item,
        new_uuid: uuidv4,
        set: (path, value) => set_at(this.model, path, value),
        propose: (it, metric, opts) => proposal_for_item(it, metric, { ...opts, resolve_unit }),
        validate: validate_proposal,
        apply: apply_proposal,
      })
      if (!res) {
        toast.error('This metric cannot take an address', {
          description: 'Its schema entry is not a Factory+ metric.',
          pauseOnHover: true,
        })
        return
      }

      this.markDirty('Address from scan')
      this.rerenderTrigger = +new Date()
      this.groupRerenderTrigger = +new Date()
      toast.success(`${res.path.join(' / ')} now reads ${item.address}`, {
        description: res.errors.length ? res.errors.join(' ') : 'Save to keep it.',
        pauseOnHover: true,
      })
    },

    openScoutMap (items) {
      this.mapItems = items
      this.mapOpen = true
    },

    /* Bulk mapping goes through the CSV import path, which creates
     * metrics and pattern objects and stamps their markers. */
    applyScoutMap (choices) {
      const rows = bulk_rows(choices.map(c => ({ ...c, metric: value_at(this.model, c.path) ?? null })), {
        resolve_unit: this.units.ready ? this.units.resolve : undefined,
      })
      const result = this.applyRows(rows)
      this.mapOpen = false
      this.$refs.scoutPanel?.clear_checked()
      if (result.applied > 0)
        toast.success(`${result.applied} metric${result.applied === 1 ? '' : 's'} mapped from the scan`, {
          description: 'Save to keep them.',
          pauseOnHover: true,
        })
      if (result.skipped > 0)
        toast.warning(`${result.skipped} address${result.skipped === 1 ? '' : 'es'} not mapped`, {
          description: 'The schema has no metric at that path.',
          pauseOnHover: true,
        })
    },

    /* The picker a version 2 driver UI opens with pick-address. */
    openPicker (filter) {
      if (this.picker.open) return Promise.resolve(null)
      return new Promise(resolve => {
        this.picker.filter = filter ?? {}
        this.picker.resolve = resolve
        this.picker.open = true
      })
    },

    closePicker (item) {
      const resolve = this.picker.resolve
      this.picker.open = false
      this.picker.resolve = null
      resolve?.(item ?? null)
    },

    startResize (event) {
      const startX = event.clientX
      /* Start from the width on screen, which max-width may hold below
       * the stored width, so the edge moves with the pointer at once. */
      const startWidth = event.currentTarget?.parentElement?.offsetWidth || this.scoutWidth
      this.onResizeMove = e => this.setScoutWidth(startWidth + (startX - e.clientX))
      this.onResizeEnd = () => this.stopResize()
      document.addEventListener('mousemove', this.onResizeMove)
      document.addEventListener('mouseup', this.onResizeEnd)
    },

    stopResize () {
      if (this.onResizeMove) document.removeEventListener('mousemove', this.onResizeMove)
      if (this.onResizeEnd) document.removeEventListener('mouseup', this.onResizeEnd)
      this.onResizeMove = this.onResizeEnd = null
      try {
        localStorage.setItem(SCOUT_WIDTH_KEY, String(this.scoutWidth))
      }
      catch {
        /* Not remembering the width is fine. */
      }
    },

    resizeBy (delta) {
      this.setScoutWidth(this.scoutWidth + delta)
      this.stopResize()
    },

    setScoutWidth (w) {
      this.scoutWidth = Math.round(Math.min(SCOUT_WIDTH_MAX, Math.max(SCOUT_WIDTH_MIN, w)))
    },

    ensureParentObjectsExpanded(path) {
      // This method ensures that all parent objects of the selected metric are expanded
      // It updates the toggle state in localStorage directly, which will be read by the SchemaGroup component
      if (!path || path.length === 0) return;

      const toggleStateKey = `toggleState-${this.model.Instance_UUID || 'unknown'}`;
      let currentToggleState;

      try {
        const storedState = localStorage.getItem(toggleStateKey);
        currentToggleState = storedState ? JSON.parse(storedState) : [];
      } catch (e) {
        console.warn('Failed to parse toggle state from localStorage', e);
        currentToggleState = [];
      }

      // For each level in the path, ensure it's expanded in the toggle state
      let pathSoFar = [];
      for (let i = 0; i < path.length - 1; i++) { // Skip the last one which is the metric itself
        pathSoFar.push(path[i]);
        const parentPath = pathSoFar.join('.');

        // Find if the parent path exists in the toggle state
        const parentIndex = currentToggleState.findIndex(item => {
          const [itemPath] = item.split(':state=');
          return itemPath === parentPath || itemPath.endsWith(`:${parentPath}`);
        });

        if (parentIndex !== -1) {
          // Update to ensure it's expanded
          currentToggleState[parentIndex] = `${parentPath}:state=open`;
        } else {
          // Add it as expanded
          currentToggleState.push(`${parentPath}:state=open`);
        }
      }

      // Save back to localStorage
      localStorage.setItem(toggleStateKey, JSON.stringify(currentToggleState));
    },

    metricDetailsEdited (val) {
      this.markDirty('Metric edited')
    },

    removeMetric (path) {
      // Remove the metric from the model
      let currentObj = this.model;
      for (let i = 0; i < path.length - 1; i++) {
        if (!currentObj || typeof currentObj !== 'object') return;
        currentObj = currentObj[path[i]];
      }

      // Delete the metric
      if (currentObj && typeof currentObj === 'object') {
        delete currentObj[path[path.length - 1]];
        this.markDirty('Metric removed');

        // Clear the selected metric
        this.selectedMetric = null;

        // Trigger a re-render of the schema group
        this.groupRerenderTrigger = +new Date();
      }
    },

    handleToggleShowOnlyPopulated(value) {
      this.showOnlyPopulated = value;

      // Trigger a re-render of the schema group to ensure the UI updates
      this.groupRerenderTrigger = +new Date();
    },

    markDirty () {
      this.isDirty = true
    },

    resetModel() {
      // Reset the model to an empty object
      this.model = {}
      // Clear the selected metric
      this.selectedMetric = null
      // Reset the dirty state
      this.isDirty = false
    },

    prepareModelForSaving () {

      // Set the top level Schema_UUID
      this.model.Schema_UUID = this.deviceSchema.uuid

      // Set the top level Instance_UUID to the ConfigDB object UUID.
      // This ensures stability across schema changes and alignment with the
      // device's identity in ConfigDB.
      this.set('Instance_UUID', this.device.uuid, this.model)

    },

    set (path, toValue, onObject, delimiter = '.') {
      let schema = onObject; // a moving reference to internal objects within obj
      const pList = path.split(delimiter);
      const len = pList.length;

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i];
        // If the property does not exist or is not an object, create it as a plain object
        if (!Object.prototype.hasOwnProperty.call(schema, elem) || typeof schema[elem] !== 'object' || schema[elem] === null) {
          schema[elem] = {};
        }
        schema = schema[elem];
      }

      // Direct assignment works in Vue 3 for reactive objects
      schema[pList[len - 1]] = toValue;
    },

    unset (path, onObject) {
      let schema  = onObject  // a moving reference to internal objects within obj
      const pList = path.split('.')
      const len   = pList.length

      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i]
        if (!schema[elem]) schema[elem] = {}
        schema = schema[elem]
      }
      delete schema[pList[len - 1]]
    },

    validateModel() {

      // XXX - Validation is currently disabled
      return { valid: true };

      // Create a new Ajv instance
      const ajv = new Ajv({ allErrors: true, strictTypes: false });
      // Add format validators
      addFormats(ajv);
      // Add vocabulary for schema keywords that aren't strictly part of validation
      ajv.addVocabulary(['options', 'headerTemplate', 'links']);

      try {
        // Compile the schema
        const validate = ajv.compile(this.schema);

        // Validate the model against the schema
        const valid = validate(this.model);

        if (!valid) {
          // Format validation errors for display
          const errors = validate.errors.map(error => {
            const path = error.instancePath || 'root';
            return `${path}: ${error.message}`;
          });

          return {
            valid: false,
            errors: errors
          };
        }

        return { valid: true };
      } catch (err) {
        console.error('Schema validation error:', err);
        return {
          valid: false,
          errors: [`Schema validation failed: ${err.message}`]
        };
      }
    },

    getDriverPresentation () {
      const connectionUuid = this.device.deviceInformation?.connection
      if (!connectionUuid) return null
      const connectionInfo = this.conn.data.find(c => c.uuid === connectionUuid)
      return connectionInfo?.configuration?.driver?.presentation || null
    },

    handleDownloadCsv () {
      const driverPresentation = this.getDriverPresentation()
      const schemaInfo = this.sch.data.find(s => s.uuid === this.schema.properties.Schema_UUID.const)
      // Add Schema Type from schema.schemaInformation.name
      const schemaType = schemaInfo?.schemaInformation?.name || ''
      const csvString = generateCsv(this.model, this.schema, driverPresentation, schemaType)
      const deviceName = this.device.name || this.device.uuid || 'device'
      const safeName = deviceName.replace(/[^a-zA-Z0-9_-]/g, '_')
      downloadCsv(csvString, `${safeName}_origin_map.csv`)
    },

    handleCsvFileSelected (event) {
      const file = event.target.files?.[0]
      if (!file) return

      if (file.size > 5 * 1024 * 1024) {
        toast.error('CSV file is too large', { description: 'Maximum file size is 5 MB.', pauseOnHover: true })
        this.$refs.csvFileInput.value = ''
        return
      }

      const reader = new FileReader()
      reader.onerror = () => {
        toast.error('Failed to read file', { pauseOnHover: true })
      }
      reader.onload = (e) => {
        const csvString = e.target.result
        const driverPresentation = this.getDriverPresentation()
        // Parse CSV and extract schema type from header/rows
        const { rows } = parseCsv(csvString, driverPresentation)

        // Find Schema_Type column in CSV header
        const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true })
        const schemaTypeCol = (parsed.meta.fields || []).find(f => f === 'Schema_Type')
        let csvSchemaType = ''
        if (schemaTypeCol && parsed.data.length > 0) {
          // Find the first non-empty Schema_Type value
          for (const row of parsed.data) {
            if (row['Schema_Type'] && row['Schema_Type'].trim() !== '') {
              csvSchemaType = row['Schema_Type'].trim()
              break
            }
          }
        }

        // Get current device schema type
        let deviceSchemaType = ''
        if (this.schema && this.schema.properties && this.schema.properties.Schema_UUID) {
          const schemaInfo = this.sch.data.find(s => s.uuid === this.schema.properties.Schema_UUID.const)
          deviceSchemaType = schemaInfo?.schemaInformation?.name || ''
        }

        if (csvSchemaType && deviceSchemaType && csvSchemaType !== deviceSchemaType) {
          toast.error('CSV Schema Type does not match device Schema Type', {
            description: `CSV Schema Type: ${csvSchemaType}, Device Schema Type: ${deviceSchemaType}`,
            pauseOnHover: true,
          })
          this.$refs.csvFileInput.value = ''
          return
        }

        if (rows.length === 0) {
          toast.error('No data rows found in CSV', { pauseOnHover: true })
          return
        }

        /* Units come from the vocabulary: refuse ones it does not have. */
        const units = useEngUnitStore()
        if (!units.ready) {
          toast.error('Units are still loading', { description: 'Try again in a moment.', pauseOnHover: true })
          return
        }
        const badUnits = csv_unit_problems(rows, units.resolve, this.model)
        if (badUnits.length > 0) {
          const listed = badUnits.slice(0, 5).map(b => `${b.tagPath}: ${b.unit}`).join(', ')
          toast.error(`${badUnits.length} row${badUnits.length === 1 ? ' has a unit' : 's have units'} not in the vocabulary`, {
            description: `${listed}${badUnits.length > 5 ? ', ...' : ''}. Add them on the Units page, or fix the CSV.`,
            pauseOnHover: true,
          })
          return
        }

        this.csvParsedData = rows
        this.csvDialogOpen = true

      }
      reader.readAsText(file)
      
      // Reset input so the same file can be re-selected
      this.$refs.csvFileInput.value = ''
    },

    /**
     * Apply CSV-shaped rows to the model. The CSV import and Edge Scout's
     * bulk mapping both come through here.
     */
    applyRows (rows) {
      // Pass the schema to applyCsvToModel so missing metrics can be created
      const result = applyCsvToModel(rows, this.model, this.schema, this.set)

      // Force model replacement to trigger Vue reactivity
      this.model = JSON.parse(JSON.stringify(this.model))

      // The import may have created schema-array instances; materialise
      // them into the schema tree or the sidebar cannot render them.
      this.updateDynamicSchemaObjects()

      this.markDirty()
      this.groupRerenderTrigger = +new Date()
      this.rerenderTrigger = +new Date()
      this.selectedMetric = null

      return result
    },

    applyParsedCsv () {
      if (!this.csvParsedData) return { applied: 0, skipped: 0, ignored: 0 }

      const result = this.applyRows(this.csvParsedData)

      if (result.applied > 0) {
        toast.success(`${result.applied} metric${result.applied === 1 ? '' : 's'} updated from CSV`, { pauseOnHover: true })
      }

      if (result.placeholders > 0) {
        toast.warning(`${result.placeholders} placeholder row${result.placeholders === 1 ? '' : 's'} skipped`, {
          description: 'Rows under a "<new>" instance are templates. Create the instance first, re-export, and fill the real rows.',
          pauseOnHover: true,
        })
      }

      if (result.skipped > 0) {
        toast.warning(`${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped`, {
          description: 'Paths not found in schema.',
          pauseOnHover: true,
        })
      }

      if (result.ignored > 0) {
        toast.warning(`${result.ignored} ISA-95 row${result.ignored === 1 ? '' : 's'} ignored`, {
          description: 'Set the hierarchy in the ISA-95 Hierarchy panel.',
          pauseOnHover: true,
        })
      }

      return result
    },

    async handleCsvSave () {
      this.applyParsedCsv()
      this.csvDialogOpen = false
      this.csvParsedData = null
      await this.save()
    },

    handleCsvReview () {
      this.applyParsedCsv()
      this.csvDialogOpen = false
      this.csvParsedData = null
      toast.info('CSV imported', {
        description: 'Review changes and save manually.',
        pauseOnHover: true,
      })
    },

    async save () {
      if (this.loading) {
        return
      }
      this.loading = true

      this.prepareModelForSaving()

      // Validate the model against the schema
      const validation = this.validateModel();
      if (!validation.valid) {
        this.loading = false;

        // Show validation errors to the user
        toast.error('Validation failed', {
          description: 'The origin map contains errors that need to be fixed.',
          pauseOnHover: true,
          action: {
            label: 'View Errors',
            onClick: () => {
              // Display the errors in a more readable format
              console.error('Validation errors:', validation.errors);

              // Show the first few errors to the user
              const firstErrors = validation.errors.slice(0, 3);
              firstErrors.forEach(error => {
                toast.error('Validation Error', {
                  description: error,
                  duration: 5000,
                  pauseOnHover: true,
                });
              });

              if (validation.errors.length > 3) {
                toast.error('Additional Errors', {
                  description: `${validation.errors.length - 3} more errors found. Check the console for details.`,
                  duration: 5000,
                  pauseOnHover: true,
                });
              }
            }
          }
        });
        return;
      }

      // Patch the Device Information application
      try {
        await this.s.client.ConfigDB.patch_config(UUIDs.App.DeviceInformation, this.device.uuid, "merge", { originMap: this.model })

        // BUG HERE - USES OLD CONFIG. MAKE SURE THAT updateEdgeAgentConfig refreshes all stores when it's called

        await updateEdgeAgentConfig({
          deviceId: this.device.uuid
        })

        this.loading = false
        this.isDirty = false
        toast.success('Origin Map updated successfully', { pauseOnHover: true })
      }
      catch (err) {
        this.loading = false
        toast.error('Unable to update Origin Map', { pauseOnHover: true })
        console.error(err)
      }
    },

  },

  data () {
    return {
      schema: null,
      isDirty: false,
      loadingExistingConfig: false,
      loading: false,
      selectedMetric: null,
      groupRerenderTrigger: +new Date(),
      rerenderTrigger: +new Date(),
      model: {},
      schemaBrowserVisible: false,
      showCDSImport: false,
      controls: [],
      showOnlyPopulated: false,

      newObjectContext: null,

      csvDialogOpen: false,
      csvParsedData: null,

      /* Edge Scout */
      /* The panel replaces the device page's info sidebar while it is
       * open, so it starts wide enough for an address and its name. */
      scoutWidth: 640,
      scoutExpanded: false,
      /* The metric path Pick from scan fills, while it waits. */
      scoutPickFor: null,
      mapOpen: false,
      mapItems: [],
      picker: { open: false, filter: {}, resolve: null },
    }
  },
}
</script>

<style scoped>
/* Apply these styles to the component's root element */
:deep(html), :deep(body), :deep(#app) {
    height: 100%;
    overflow: hidden;
}

/* Ensure the component takes up the full height */
.h-full {
    height: 100%;
}

/* Ensure scrollable areas have proper overflow behavior */
.overflow-auto {
    overflow: auto;
}

/* Prevent overflow on containers */
.overflow-hidden {
    overflow: hidden;
}
</style>


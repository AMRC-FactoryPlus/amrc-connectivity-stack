<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="!!target" @update:open="handleOpen">
    <DialogContent v-if="target" class="sm:max-w-[700px] max-h-[85vh]">
      <DialogHeader>
        <DialogTitle>Move {{target.name}} to another host</DialogTitle>
        <DialogDescription>
          {{step === 3
            ? 'The move is complete.'
            : `Choose the host in ${cluster?.name ?? 'this cluster'} that should run this ${kindLabel}.`}}
        </DialogDescription>
      </DialogHeader>

      <!-- Step 1: choose the target host -->
      <div v-if="step === 1" class="flex flex-col gap-3 overflow-auto max-h-[55vh] flex-1 fix-inset">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Currently on</label>
          <div class="flex items-center gap-2 text-sm">
            <i class="fa-fw fa-solid fa-server text-gray-400"></i>
            <span class="font-medium">{{currentHostname ?? 'Floating'}}</span>
            <span v-if="currentHostStale" class="text-amber-600">
              not currently a host in this cluster
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Move to</label>
          <div v-if="!hosts.length" class="text-sm text-gray-400">
            This cluster is not reporting any hosts, so there is nowhere to move to.
          </div>
          <div v-else class="flex flex-col gap-1 max-h-64 overflow-auto">
            <button
                v-for="host in hosts"
                :key="host.hostname ?? 'floating'"
                type="button"
                class="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-gray-50"
                :class="isSelected(host) ? 'border-gray-950 bg-gray-50' : 'border-input'"
                @click="selected = host"
            >
              <div class="flex flex-col">
                <div class="font-medium">{{host.hostname ?? 'Floating'}}</div>
                <div class="text-xs text-gray-400">
                  {{host.hostname ? host.arch : 'Run on any host in the cluster'}}
                </div>
              </div>
              <div class="flex items-center gap-3 text-xs text-gray-400">
                <div v-if="host.hostname === currentHostname">current host</div>
                <div v-else-if="host.hostname">{{occupancy(host.hostname)}}</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Step 2: review what comes with it -->
      <div v-if="step === 2" class="flex flex-col gap-4 overflow-auto max-h-[55vh] flex-1 fix-inset">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">{{currentHostname ?? 'Floating'}}</span>
          <i class="fa-solid fa-arrow-right text-gray-400"></i>
          <span class="font-medium">{{selected?.hostname ?? 'Floating'}}</span>
        </div>

        <div v-if="valuesOverrideHostname"
            class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
          <div>
            This deployment sets <span class="font-mono">hostname</span> in its own Helm values,
            which is applied after the host selected here. The move will not take effect until
            that value is removed from the deployment's values.
          </div>
        </div>

        <div v-if="isNode" class="flex flex-col gap-2">
          <div class="text-sm font-medium">
            {{connections.length}} connection{{connections.length === 1 ? '' : 's'}}
          </div>
          <div v-if="!connections.length" class="text-sm text-gray-400">
            This node has no connections.
          </div>
          <div v-for="conn in connections" :key="conn.uuid" class="rounded-md border p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div class="font-medium text-sm">{{conn.name}}</div>
              <div class="text-xs text-gray-400">{{conn.driverName ?? 'no driver'}}</div>
            </div>
            <HostPathsEditor v-model="hostPaths[conn.uuid]"/>
          </div>
          <div v-if="anyHostPaths"
              class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
            <div>
              Host paths have been carried over unchanged. ACS cannot check whether these
              exist on {{selected?.hostname ?? 'the new host'}}. Confirm them against the new
              machine before moving.
            </div>
          </div>
        </div>

        <div v-if="isNode" class="text-sm text-gray-400">
          {{devices.length}} device{{devices.length === 1 ? '' : 's'}} unaffected, they follow the node.
        </div>
        <div v-else class="text-sm text-gray-400">
          Nothing else references this host.
        </div>
      </div>

      <!-- Step 3: done -->
      <div v-if="step === 3" class="flex flex-col gap-3 overflow-auto flex-1 fix-inset">
        <div class="flex items-center gap-2 text-sm">
          <i class="fa-solid fa-circle-check text-green-600"></i>
          <span>Moved to <span class="font-medium">{{selected?.hostname ?? 'Floating'}}</span>.</span>
        </div>
        <div class="text-sm text-gray-500">
          The workload will be rescheduled onto the new host. A node will go offline and
          rebirth as its edge agent restarts.
        </div>
        <div v-if="failed.length"
            class="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
          <div>
            These connections could not be updated and still refer to the old host:
            {{failed.join(', ')}}.
          </div>
        </div>
      </div>

      <DialogFooter>
        <div class="flex w-full items-center justify-between">
          <Button v-if="step === 2" variant="outline" :disabled="moving" @click="step = 1">Back</Button>
          <div v-else></div>

          <div class="flex items-center gap-2">
            <Button v-if="step !== 3" variant="outline" :disabled="moving" @click="handleOpen(false)">Cancel</Button>
            <Button v-if="step === 1" :disabled="!selected || isSelected({hostname: currentHostname})" @click="step = 2">
              Next
            </Button>
            <Button v-if="step === 2" :disabled="moving" @click="move">
              <div class="flex items-center justify-center gap-2">
                <i :class="{
                  'fa-solid': true,
                  'fa-right-left': !moving,
                  'fa-circle-notch': moving,
                  'animate-spin': moving,
                }"></i>
                <div>{{moving ? 'Moving...' : `Move to ${selected?.hostname ?? 'Floating'}`}}</div>
              </div>
            </Button>
            <Button v-if="step === 3" @click="handleOpen(false)">Done</Button>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Button } from '@components/ui/button/index.js'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import HostPathsEditor from '@components/EdgeManager/Connections/HostPathsEditor.vue'
import { useConnectionStore } from '@store/useConnectionStore.js'
import { useDeploymentStore } from '@store/useDeploymentStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { hostIsKnown } from '@utils/hosts.js'
import { moveHost } from '@utils/moveHost.js'
import { toast } from 'vue-sonner'

export default {
  name: 'MoveHostDialog',

  components: {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    HostPathsEditor,
  },

  setup () {
    return {
      c: useEdgeClusterStore(),
      n: useNodeStore(),
      dp: useDeploymentStore(),
      d: useDeviceStore(),
      cn: useConnectionStore(),
    }
  },

  mounted () {
    /* `target` is `{ uuid, name, kind, deployment }`, where deployment is
     * the Edge deployment config for the object. */
    window.events.on('show-move-host-dialog', target => {
      this.target = target
      this.step = 1
      this.selected = null
      this.failed = []
      this.hostPaths = {}
      this.cn.start()
      this.d.start()
      this.dp.start()
    })
  },

  computed: {
    isNode () {
      return this.target?.kind === 'node'
    },

    kindLabel () {
      return this.isNode ? 'node' : 'deployment'
    },

    cluster () {
      return this.c.data.find(e => e.uuid === this.target?.deployment?.cluster)
    },

    currentHostname () {
      return this.target?.deployment?.hostname ?? null
    },

    currentHostStale () {
      return !hostIsKnown(this.cluster, this.currentHostname)
    },

    hosts () {
      const hosts = this.cluster?.status?.hosts
      if (!Array.isArray(hosts) || !hosts.length) return []
      return [...hosts, { hostname: null, arch: 'any' }]
    },

    valuesOverrideHostname () {
      return this.target?.deployment?.values?.hostname != null
    },

    connections () {
      if (!this.isNode) return []
      return (Array.isArray(this.cn.data) ? this.cn.data : [])
        .filter(e => e.configuration?.edgeAgent === this.target?.uuid)
        .map(e => ({
          uuid: e.uuid,
          name: e.name,
          driverName: e.configuration?.driver?.name,
          hostPaths: e.configuration?.deployment?.hostPaths ?? [],
        }))
    },

    devices () {
      if (!this.isNode) return []
      return (Array.isArray(this.d.data) ? this.d.data : [])
        .filter(e => e.deviceInformation?.node === this.target?.uuid)
    },

    anyHostPaths () {
      return Object.values(this.hostPaths).some(p => p?.length)
    },
  },

  watch: {
    /* Seed the editable host paths from the connections as soon as the
     * connection store has caught up. */
    connections: {
      immediate: true,
      handler (connections) {
        for (const conn of connections) {
          if (this.hostPaths[conn.uuid]) continue
          this.hostPaths[conn.uuid] = conn.hostPaths.map(p => ({ ...p }))
        }
      },
    },
  },

  methods: {
    handleOpen (open) {
      if (open === false) {
        this.target = null
        this.step = 1
        this.selected = null
        this.failed = []
        this.hostPaths = {}
      }
    },

    isSelected (host) {
      if (!this.selected) return false
      return (this.selected.hostname ?? null) === (host.hostname ?? null)
    },

    occupancy (hostname) {
      const on = xs => (Array.isArray(xs) ? xs : [])
        .filter(e => e.deployment?.cluster === this.cluster?.uuid
          && e.deployment?.hostname === hostname).length
      const count = on(this.n.data) + on(this.dp.data)
      if (!count) return 'nothing deployed here'
      return `${count} deployment${count === 1 ? '' : 's'}`
    },

    /* Only send host paths we were asked to change, so that a connection
     * we did not touch is left exactly as it was. */
    changedConnections () {
      return this.connections.map(conn => {
        const edited = (this.hostPaths[conn.uuid] ?? [])
          .filter(p => p.hostPath || p.mountPath)
        return {
          uuid: conn.uuid,
          name: conn.name,
          hostPaths: edited,
          hostPathsChanged:
            JSON.stringify(edited) !== JSON.stringify(conn.hostPaths),
        }
      })
    },

    async move () {
      this.moving = true
      try {
        const { failed } = await moveHost({
          deploymentUuid: this.target.uuid,
          hostname: this.selected.hostname ?? null,
          connections: this.changedConnections(),
        })

        this.failed = failed
        this.step = 3

        if (failed.length) {
          toast.warning(`${this.target.name} was moved, but some connections could not be updated`)
        }
        else {
          toast.success(`${this.target.name} has been moved to ${this.selected.hostname ?? 'Floating'}`)
        }
      }
      catch (err) {
        console.error(err)
        toast.error(`Unable to move ${this.target?.name}`)
      }
      finally {
        this.moving = false
      }
    },
  },

  data () {
    return {
      target: null,
      step: 1,
      selected: null,
      moving: false,
      failed: [],
      hostPaths: {},
    }
  },
}
</script>

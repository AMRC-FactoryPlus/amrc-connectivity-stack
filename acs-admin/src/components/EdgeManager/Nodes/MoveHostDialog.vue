<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="!!target" @update:open="handleOpen">
    <DialogContent v-if="target" class="sm:max-w-[680px] max-h-[80vh]">
      <DialogHeader>
        <div class="flex items-start justify-between gap-4 pr-8">
          <div class="flex flex-col gap-1">
            <DialogTitle>Move {{target.name}} to another host</DialogTitle>
            <DialogDescription>{{stepDescription}}</DialogDescription>
          </div>
          <div class="flex flex-col items-end gap-1.5 flex-none">
            <span class="text-[11px] text-gray-400 whitespace-nowrap">Step {{step}} of 2</span>
            <div class="flex gap-1">
              <span class="w-[22px] h-[3px] rounded-sm bg-slate-900"></span>
              <span class="w-[22px] h-[3px] rounded-sm" :class="step === 2 ? 'bg-slate-900' : 'bg-slate-200'"></span>
            </div>
          </div>
        </div>
      </DialogHeader>

      <!-- Step 1: choose the target host -->
      <div v-if="step === 1" class="flex flex-col gap-4 overflow-y-auto max-h-[50vh] fix-inset">
        <div class="flex items-center gap-2.5 flex-wrap rounded-md bg-gray-50 px-3 py-2.5">
          <span class="text-[11px] uppercase tracking-wide text-gray-400">Currently on</span>
          <span class="text-sm font-medium font-mono">{{currentHostname ?? 'Floating'}}</span>
          <StaleHostPill v-if="currentHostStale"/>
        </div>

        <div v-if="!reportedHosts.length && !offerFloating" class="text-sm text-gray-400">
          This cluster is not reporting any other hosts, so there is nowhere to move to.
        </div>

        <div v-if="reportedHosts.length" class="flex flex-col gap-2">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Hosts reported by this cluster
          </div>
          <button
              v-for="host in reportedHosts"
              :key="host.hostname"
              type="button"
              class="relative flex items-center gap-3 w-full text-left px-3.5 py-3 rounded-md bg-white ring-1 ring-inset ring-slate-200 hover:bg-gray-50"
              :class="isSelected(host.hostname) ? 'ring-2 ring-slate-900' : ''"
              @click="selected = host.hostname"
          >
            <span class="relative w-4 h-4 rounded-full flex-none ring-[1.5px] ring-inset ring-slate-300"
                :class="isSelected(host.hostname) ? 'ring-[5px] ring-slate-900' : ''"></span>
            <span class="flex flex-col gap-0.5 min-w-0 flex-1">
              <span class="text-sm font-medium font-mono">{{host.hostname}}</span>
              <span class="flex items-center gap-1.5 text-xs text-gray-400">
                <i class="fa-solid fa-microchip text-[10px]"></i>{{host.arch}}
              </span>
            </span>
            <span class="text-xs text-gray-500 flex-none">{{occupancy(host.hostname)}}</span>
          </button>
        </div>

        <div v-if="offerFloating" class="flex flex-col gap-2">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Or leave it to the scheduler
          </div>
          <button
              type="button"
              class="relative flex items-center gap-3 w-full text-left px-3.5 py-3 rounded-md bg-white ring-1 ring-inset ring-slate-200 hover:bg-gray-50"
              :class="isSelected(null) ? 'ring-2 ring-slate-900' : ''"
              @click="selected = null; floatingChosen = true"
          >
            <span class="relative w-4 h-4 rounded-full flex-none ring-[1.5px] ring-inset ring-slate-300"
                :class="isSelected(null) ? 'ring-[5px] ring-slate-900' : ''"></span>
            <span class="flex flex-col gap-0.5 flex-1">
              <span class="text-sm font-medium">Floating</span>
              <span class="text-xs text-gray-400">Any host in the cluster. Host paths will not be guaranteed.</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Step 2: review what comes with it -->
      <div v-if="step === 2" class="flex flex-col gap-4 overflow-y-auto max-h-[50vh] fix-inset">
        <div class="flex items-center gap-3 rounded-md bg-gray-50 px-3 py-2.5">
          <span class="text-sm text-gray-500 font-mono">{{currentHostname ?? 'Floating'}}</span>
          <i class="fa-solid fa-arrow-right text-[11px] text-gray-400"></i>
          <span class="text-sm font-semibold font-mono">{{targetLabel}}</span>
        </div>

        <div v-if="valuesOverrideHostname"
            class="flex gap-2.5 rounded-md bg-amber-50 ring-1 ring-inset ring-amber-200 p-3">
          <i class="fa-solid fa-triangle-exclamation text-xs text-amber-700 mt-0.5"></i>
          <div class="text-xs leading-relaxed text-amber-800">
            This deployment sets <span class="font-mono">hostname</span> in its own Helm values,
            which is applied after the host selected here. The move will not take effect until
            that value is removed from the deployment's values.
          </div>
        </div>

        <template v-if="isNode">
          <div v-if="anyHostPaths"
              class="flex gap-2.5 rounded-md bg-amber-50 ring-1 ring-inset ring-amber-200 p-3">
            <i class="fa-solid fa-triangle-exclamation text-xs text-amber-700 mt-0.5"></i>
            <div class="text-xs leading-relaxed text-amber-800">
              Host paths are copied across unchanged. ACS cannot inspect the filesystem of
              <span class="font-semibold">{{targetLabel}}</span>, so check the hardware is
              attached there before moving.
            </div>
          </div>

          <div class="flex flex-col gap-2.5">
            <div class="flex items-baseline justify-between gap-3">
              <div class="text-[13px] font-semibold">
                Connections moving with this node
                <span class="text-gray-400 font-medium">· {{connections.length}}</span>
              </div>
              <div class="text-xs text-gray-400">{{devicesUnaffected}}</div>
            </div>

            <div v-if="!connections.length" class="text-sm text-gray-400">
              This node has no connections.
            </div>

            <div v-for="conn in connections" :key="conn.uuid"
                class="rounded-md ring-1 ring-inset ring-slate-200 overflow-hidden">
              <div class="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50">
                <span class="text-[13px] font-semibold">{{conn.name}}</span>
                <span class="text-[11px] text-gray-500 px-1.5 py-0.5 rounded-full bg-white ring-1 ring-slate-200">
                  {{conn.driverName ?? 'no driver'}}
                </span>
              </div>
              <div class="px-3 py-2.5">
                <HostPathsEditor v-model="hostPaths[conn.uuid]"/>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="text-sm text-gray-400">
          Nothing else references this host.
        </div>
      </div>

      <DialogFooter>
        <div class="flex w-full items-center justify-between">
          <Button v-if="step === 2" variant="ghost" class="gap-2" :disabled="moving" @click="step = 1">
            <i class="fa-solid fa-arrow-left text-[11px]"></i>Back
          </Button>
          <div v-else></div>

          <div class="flex items-center gap-2">
            <Button variant="outline" :disabled="moving" @click="handleOpen(false)">Cancel</Button>
            <Button
                v-if="step === 1"
                class="gap-2"
                :disabled="!hasTarget"
                :title="hasTarget ? undefined : 'Select a host first'"
                @click="step = 2"
            >
              Next<i class="fa-solid fa-arrow-right text-[11px]"></i>
            </Button>
            <Button v-else class="gap-2" :disabled="moving" @click="move">
              <i :class="['fa-solid', moving ? 'fa-circle-notch animate-spin' : 'fa-right-left', 'text-[11px]']"></i>
              {{moving ? 'Moving...' : `Move to ${targetLabel}`}}
            </Button>
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
import StaleHostPill from '@components/EdgeManager/Nodes/StaleHostPill.vue'
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
    StaleHostPill,
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
      this.reset()
      this.target = target
      this.cn.start()
      this.d.start()
      this.dp.start()
    })
  },

  computed: {
    isNode () {
      return this.target?.kind === 'node'
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

    /* The host it is already on is shown once above the list, so it is
     * not offered as an option. */
    reportedHosts () {
      const hosts = this.cluster?.status?.hosts
      if (!Array.isArray(hosts)) return []
      return hosts.filter(h => h.hostname !== this.currentHostname)
    },

    offerFloating () {
      return this.currentHostname !== null
    },

    hasTarget () {
      return this.selected !== null || this.floatingChosen
    },

    targetLabel () {
      return this.selected ?? 'Floating'
    },

    stepDescription () {
      return this.step === 1
        ? `Pick the host in ${this.cluster?.name ?? 'this cluster'} that should run this node.`
        : 'Check what moves with it, then apply.'
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

    devicesUnaffected () {
      const n = this.devices.length
      return n === 1 ? '1 device is unaffected' : `${n} devices are unaffected`
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
    reset () {
      this.target = null
      this.step = 1
      this.selected = null
      this.floatingChosen = false
      this.hostPaths = {}
    },

    handleOpen (open) {
      if (open === false) this.reset()
    },

    isSelected (hostname) {
      if (!this.hasTarget) return false
      return this.selected === hostname
    },

    occupancy (hostname) {
      const on = xs => (Array.isArray(xs) ? xs : [])
        .filter(e => e.deployment?.cluster === this.cluster?.uuid
          && e.deployment?.hostname === hostname).length
      const count = on(this.n.data) + on(this.dp.data)
      if (!count) return 'Nothing deployed'
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
      const name = this.target.name
      const to = this.targetLabel
      try {
        const { failed } = await moveHost({
          deploymentUuid: this.target.uuid,
          hostname: this.selected,
          connections: this.changedConnections(),
        })

        this.reset()

        if (failed.length) {
          toast.error(`${name} moved to ${to}, with problems`, {
            description: `These connections still refer to the old host: ${failed.join(', ')}.`,
          })
        }
        else {
          toast.success(`${name} moved to ${to}`, {
            description: 'The edge agent is being rescheduled. The node will go '
              + 'offline briefly and rebirth.',
          })
        }
      }
      catch (err) {
        console.error(err)
        toast.error(`Unable to move ${name}`)
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
      /* The chosen hostname, or null for Floating. `floatingChosen`
       * distinguishes "Floating was picked" from "nothing picked yet". */
      selected: null,
      floatingChosen: false,
      moving: false,
      hostPaths: {},
    }
  },
}
</script>

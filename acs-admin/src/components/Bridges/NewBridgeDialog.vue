<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[900px] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? 'Edit Bridge' : 'Create a New Bridge' }}</DialogTitle>
        <DialogDescription>{{ isEditMode ? 'Update the bridge configuration' : 'Configure a UNS bridge to forward messages between MQTT brokers' }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-4 flex-1 fix-inset">
        <!-- Bridge Name -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Bridge Name <span class="text-red-500">*</span></label>
          <Input
            placeholder="e.g. Building 1 Bridge"
            v-model="v$.name.$model"
            :v="v$.name"
          />
        </div>

        <!-- Bridge Type Selection -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Bridge Type <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-2 gap-2">
            <Button 
              :variant="bridgeType === 'outgoing' ? 'default' : 'outline'"
              @click="bridgeType = 'outgoing'"
              class="h-20 whitespace-normal"
            >
              <div class="flex gap-2 items-center w-full pl-3">
                <i class="fa-solid fa-arrows-up-to-line text-xl mr-2"></i>
                <div class="flex flex-col">
                  <div class="text-sm text-left" :class="bridgeType === 'outgoing' ? 'text-gray-200' : 'text-gray-900'">Outgoing</div>
                  <div class="text-gray-400 text-xs text-left">
                    Forward messages from this cluster to a remote broker
                  </div>
                </div>
              </div>
            </Button>
            <Button
              :variant="bridgeType === 'incoming' ? 'default' : 'outline'"
              @click="bridgeType = 'incoming'"
              class="h-20 whitespace-normal"
            >
              <div class="flex gap-2 items-center w-full pl-3">
                <i class="fa-solid fa-arrows-down-to-line text-xl mr-2"></i>
                <div class="flex flex-col">
                  <div class="text-sm text-left" :class="bridgeType === 'incoming' ? 'text-gray-200' : 'text-gray-900'">Incoming</div>
                  <div class="text-gray-400 text-xs text-left">
                    Allow a remote cluster to publish messages into this UNS
                  </div>
                </div>
              </div>
            </Button>
          </div>
        </div>

        <!-- Edge Cluster Selection -->
        <div v-if="bridgeType === 'outgoing'" class="flex flex-col gap-1">
          <label class="text-sm font-medium">Edge Cluster <span class="text-red-500">*</span></label>
          <Select v-model="selectedClusterUuid">
            <SelectTrigger :class="{'border-red-500': v$.selectedClusterUuid.$error}">
              <SelectValue>
                {{ selectedCluster?.name ?? 'Select a cluster...' }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="cluster in clusters" :value="cluster.uuid" :key="cluster.uuid">
                  <div class="flex items-center gap-2">
                    <div class="font-medium">{{ cluster.name }}</div>
                  </div>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <!-- Topics List -->
        <div v-if="bridgeType === 'outgoing'" class="flex flex-col gap-1">
          <label class="text-sm font-medium">Topic Filters <span class="text-red-500">*</span></label>
          <p class="text-sm text-gray-500">
            {{ bridgeType === 'outgoing' 
              ? 'Topics to subscribe to and forward to the remote broker' 
              : 'Topics the remote cluster can publish to' }}
          </p>
          <div class="flex flex-col gap-2 mt-2">
            <div v-for="(topic, index) in topics" :key="index" class="flex gap-2">
              <Input 
                v-model="topics[index]" 
                placeholder="e.g. UNS/v1/#"
                class="flex-1"
              />
              <Button variant="ghost" size="icon" @click="removeTopic(index)" :disabled="topics.length === 1">
                <i class="fa-solid fa-trash text-gray-400"></i>
              </Button>
            </div>
            <Button variant="outline" @click="addTopic" class="w-full">
              <i class="fa-solid fa-plus mr-2"></i>
              Add Topic
            </Button>
          </div>
        </div>

        <!-- Outgoing Bridge: Remote Broker Configuration -->
        <template v-if="bridgeType === 'outgoing'">
          <div class="rounded-lg border border-gray-300 p-5 bg-gray-100">
            <h4 class="font-medium mb-3">Remote Broker Configuration</h4>
            
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">Remote Host <span class="text-red-500">*</span></label>
                <Input
                  placeholder="e.g. mqtt.example.com"
                  v-model="v$.remoteHost.$model"
                  :v="v$.remoteHost"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">Remote Port <span class="text-red-500">*</span></label>
                <Input
                  type="number"
                  placeholder="8883"
                  v-model="v$.remotePort.$model"
                  :v="v$.remotePort"
                />
              </div>
            </div>

            <div class="flex items-center gap-2 mt-3">
              <Checkbox id="tls" v-model="remoteTls" />
              <label for="tls" class="text-sm font-medium cursor-pointer">Use TLS</label>
            </div>

            <div class="grid grid-cols-2 gap-4 mt-4">
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">Username <span class="text-red-500">*</span></label>
                <Input
                  v-model="v$.remoteUsername.$model"
                  :v="v$.remoteUsername"
                  :placeholder="isEditMode ? 'Leave blank to keep existing' : 'Username for remote broker'"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">Password <span class="text-red-500">*</span></label>
                <Input
                  type="password"
                  v-model="v$.remotePassword.$model"
                  :v="v$.remotePassword"
                  :placeholder="isEditMode ? 'Leave blank to keep existing' : 'Password for remote broker'"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Incoming Bridge: Info Box -->
        <template v-if="bridgeType === 'incoming'">
          <Alert>
            <AlertDescription class="text-xs text-gray-700">
              Incoming bridges are configured on the source (remote) cluster, but you need to create a KerberosKey for it to use. Run the following command to create the KerberosKey:
              <pre class="block mt-3 p-4 bg-gray-100 text-gray-800 rounded text-sm font-mono overflow-x-auto"><code>kubectl apply -f - &lt;&lt;EOF
apiVersion: factoryplus.app.amrc.co.uk&#47;v1
kind: KerberosKey
metadata:
  namespace: factory-plus
  name: uns-bridge.{{ sanitizedName }}
spec:
  type: Password
  principal: br1&#47;incoming&#47;{{ sanitizedName }}@{{ realm }}
  secret: uns-bridge-secrets.{{ sanitizedName }}&#47;keytab
  account:
    class: "97756c9a-38e6-4238-b78c-3df6f227a6c9"
    name: "UNS Incoming Bridge: {{ name || 'bridge-name' }}"
    groups:
      - "{{ unsIngesterGroup }}"
EOF</code></pre>
            </AlertDescription>
          </Alert>
        </template>
      </div>

      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button v-if="bridgeType === 'outgoing'" :disabled="v$.$invalid || isSubmitting || bridgeType === 'incoming'" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i :class="{'fa-solid': true, 'fa-plus': !isEditMode && !isSubmitting, 'fa-save': isEditMode && !isSubmitting, 'fa-circle-notch animate-spin': isSubmitting}"></i>
            <div>{{ isSubmitting ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save Changes' : 'Create Bridge') }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useEdgeClusterStore } from '@store/useEdgeClusterStore.js'
import useVuelidate from '@vuelidate/core'
import { helpers, required, numeric, requiredIf } from '@vuelidate/validators'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { serviceClientReady } from '@store/useServiceClientReady.js'

// Sanitize name for Kubernetes
function sanitizeName(name) {
  if (!name) return name;
  return name.toLowerCase()
    .replace(/[^a-z0-9-\.]/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '');
}

export default {
  setup() {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      c: useEdgeClusterStore(),
    }
  },

  components: {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Checkbox,
    Alert,
    AlertDescription,
    AlertTitle,
  },

  async mounted() {
    this.c.start()

    window.events.on('show-new-bridge-dialog', (bridge) => {
      if (bridge) {
        this.loadBridge(bridge)
      }
      this.isOpen = true
    })

    await serviceClientReady()

    // Fetch the UNS Bridge chart UUID from Service Config
    try {
      const managerConfig = await this.s.client.ConfigDB.get_config(UUIDs.App.ServiceConfig, UUIDs.Service.Manager)
      this.unsChartUuid = managerConfig?.helm?.unsBridge
    } catch (err) {
      console.error('Failed to fetch Manager config:', err)
    }
  },

  computed: {
    clusters() {
      return this.c.data.filter(cluster => cluster.status?.hosts?.length > 0)
    },
    selectedCluster() {
      return this.c.data.find(c => c.uuid === this.selectedClusterUuid)
    },
    sanitizedName() {
      return sanitizeName(this.name) || crypto.randomUUID()
    },
    realm() {
      // Extract realm from baseUrl by uppercasing it. Bad practice but will do for now.
      // e.g., "factoryplus.example.com" -> "FACTORYPLUS.EXAMPLE.COM"
      return this.s.baseUrl ? this.s.baseUrl.toUpperCase() : 'REALM.EXAMPLE.COM'
    },
    unsIngesterGroup() {
      return UUIDs.Group.UNS_Ingester
    },
    isEditMode() {
      return !!this.bridgeUuid
    }
  },

  methods: {
    addTopic() {
      this.topics.push('')
    },

    removeTopic(index) {
      if (this.topics.length > 1) {
        this.topics.splice(index, 1)
      }
    },

    handleOpen(e) {
      if (e === false) {
        setTimeout(() => this.resetForm(), 300)
      }
    },

    resetForm() {
      this.isOpen = false
      this.bridgeUuid = null
      this.name = null
      this.bridgeType = 'outgoing'
      this.selectedClusterUuid = null
      this.topics = ['']
      this.remoteHost = null
      this.remotePort = 8883
      this.remoteTls = true
      this.remoteUsername = null
      this.remotePassword = null
      this.isSubmitting = false
      this.v$.$reset()
    },

    loadBridge(bridge) {
      this.bridgeUuid = bridge.uuid
      this.name = bridge.name

      // Determine type
      const hasRemote = bridge.deployment?.values?.remote?.host
      this.bridgeType = hasRemote ? 'outgoing' : 'incoming'

      if (this.bridgeType === 'outgoing') {
        const values = bridge.deployment?.values || {}
        this.selectedClusterUuid = bridge.deployment?.cluster
        
        // Flatten topics object to array
        const topicsObj = values.topics || {}
        this.topics = Object.keys(topicsObj).length > 0 ? Object.keys(topicsObj) : ['']
        
        if (values.remote) {
          this.remoteHost = values.remote.host
          this.remotePort = values.remote.port
          this.remoteTls = values.remote.tls
        }
      }
    },

    random() {
      if (crypto.randomUUID) return crypto.randomUUID();
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      return buf.toHex();
    },

    async encryptSensitiveInfo(secretName, key, value) {
      const cluster = this.selectedClusterUuid
      const config = this.selectedCluster
      const namespace = config?.configuration?.namespace || 'fplus-edge'

      await this.s.client.Fetch.fetch({
        service: UUIDs.Service.Clusters,
        url: `v1/cluster/${cluster}/secret/${namespace}/${secretName}/${key}`,
        method: 'PUT',
        body: value,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    },

    async formSubmit() {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      this.isSubmitting = true

      try {
        // Create bridge object in ConfigDB
        let uuid = this.bridgeUuid
        if (!uuid) {
          uuid = await this.s.client.ConfigDB.create_object(UUIDs.Class.Bridge)
        }

        // Set name
        await this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
          name: this.name,
        })

        // Only create deployment config for outgoing bridges
        if (this.bridgeType === 'outgoing') {
          // Filter out empty topics and convert to object keyed by topic
          const topicsObject = this.topics
            .filter(t => t.trim() !== '')
            .reduce((acc, topic) => ({ ...acc, [topic]: {} }), {})

          // Create sealed secret for credentials
          const secretName = `bridge-${this.sanitizedName}-remote-creds`
          
          // Determine if we need to update secrets
          if (this.remoteUsername) {
            await this.encryptSensitiveInfo(secretName, 'username', this.remoteUsername)
          }
          if (this.remotePassword) {
            await this.encryptSensitiveInfo(secretName, 'password', this.remotePassword)
          }

          const values = {
            topics: topicsObject,
            local: {
              host: 'mqtt.factory-plus.svc.cluster.local',
              port: 1883
            },
            remote: {
              host: this.remoteHost.replace(/^[a-zA-Z]+:\/\//, ''),
              port: parseInt(this.remotePort),
              tls: this.remoteTls,
              secretName: secretName,
              usernameKey: 'username',
              passwordKey: 'password'
            }
          }

          // Create edge deployment config
          const deploymentPayload = {
            createdAt: new Date().toISOString(),
            name: this.sanitizedName,
            cluster: this.selectedClusterUuid,
            chart: this.unsChartUuid,
            values: values,
          }

          await this.s.client.ConfigDB.put_config(UUIDs.App.EdgeAgentDeployment, uuid, deploymentPayload)
        }

        this.resetForm()
      } catch (err) {
        console.error('Failed to create bridge:', err)
        toast.error('Unable to create bridge', {
          description: err.message || 'An unexpected error occurred',
        })
      } finally {
        this.isSubmitting = false
      }
    },
  },

  data() {
    return {
      isOpen: false,
      bridgeUuid: null,
      name: null,
      bridgeType: 'outgoing',
      selectedClusterUuid: null,
      topics: [''],
      remoteHost: null,
      remotePort: 8883,
      remoteTls: true,
      remoteUsername: null,
      remotePassword: null,
      isSubmitting: false,
      unsChartUuid: null,
    }
  },

  validations() {
    return {
      unsChartUuid: {
        required: helpers.withMessage('UNS Bridge chart UUID is required. If this is invalid then it hasn\'t been correctly fetched and this is a bug.', required),
      },
      name: {
        required,
        alphaNumUnderscoreSpace: helpers.withMessage(
          'Letters, numbers, spaces, hyphens and underscores are valid',
          (value) => /^[a-zA-Z0-9_\- ]*$/.test(value)
        ),
      },
      selectedClusterUuid: {
        requiredIfOutgoing: helpers.withMessage(
          'Please select an edge cluster',
          requiredIf(() => this.bridgeType === 'outgoing')
        ),
      },
      topics: {
        hasAtLeastOneTopic: helpers.withMessage(
          'At least one topic is required',
          (value) => this.bridgeType !== 'outgoing' || value.some(t => t.trim() !== '')
        ),
      },
      remoteHost: {
        requiredIfOutgoing: helpers.withMessage(
          'Remote host is required for outgoing bridges',
          requiredIf(() => this.bridgeType === 'outgoing')
        ),
      },
      remotePort: {
        requiredIfOutgoing: helpers.withMessage(
          'Remote port is required',
          requiredIf(() => this.bridgeType === 'outgoing')
        ),
      },
      remoteUsername: {
        requiredIfOutgoing: helpers.withMessage(
          'Username is required for outgoing bridges',
          requiredIf(() => this.bridgeType === 'outgoing' && !this.isEditMode)
        ),
      },
      remotePassword: {
        requiredIfOutgoing: helpers.withMessage(
          'Password is required for outgoing bridges',
          requiredIf(() => this.bridgeType === 'outgoing' && !this.isEditMode)
        ),
      },
    }
  },
}
</script>

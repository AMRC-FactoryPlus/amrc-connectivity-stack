<template>
  <div class="flex flex-col bg-[rgb(24,27,31)] min-h-screen">
    <div class="text-2xl m-1 mb-0 p-4 flex items-center justify-between">
      <div class="flex flex-col">
        <h1 class="text-white"><span class="font-bold mr-1">AMRC</span>Factory+</h1>
        <h1 class="text-base text-gray-200">Live Device Activity</h1>
      </div>
      <div class="flex items-center gap-2">
        <input v-if="connected === false" v-model="directories" type="text"
            class="text-sm p-2 focus:ring-2 focus:outline-none ring-gray-300 bg-gray-700 text-white placeholder-gray-300"
            placeholder="Directory">
        <input v-if="connected === false" v-model="username" type="text"
            class="text-sm p-2 focus:ring-2 focus:outline-none ring-gray-300 bg-gray-700 text-white placeholder-gray-300"
            placeholder="Username">
        <input v-if="connected === false" v-model="password" type="password"
            class="text-sm p-2 focus:ring-2 focus:outline-none ring-gray-300 bg-gray-700 text-white placeholder-gray-300"
            placeholder="Password">
        <button @click="connected === false ? createConnection() : stop()" :disabled="connecting === true"
            class="text-sm p-2 w-32"
            :class="connected ? 'bg-gray-700 hover:bg-gray-600 text-gray-100' : 'bg-white text-gray-900 hover:bg-gray-300'"
        >
          {{connected === false && connecting === false ? 'Connect' : (connecting ? 'Connecting...' : 'Disconnect')}}
        </button>
      </div>
    </div>
    <div v-if="connected" id="app"
        class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-8 w-full gap-1 p-1 line">
      <div :key="topic.path" :ref="topic.path" v-for="topic in topics"
          class="p-3 relative transition ease-out">
        <div class="flex items-center mb-1 gap-x-2 text-white">
          <div class="font-medium line-clamp-1">{{topic.device ?? topic.node}}</div>
          <div class="p-1 bg-blue-500 text-xs tracking-wider font-bold px-1.5 ml-auto" v-if="!topic.device">NODE</div>
          <div class="flex-0 p-1 px-2 flex items-center justify-center text-xs" :class="topic.device ? 'ml-auto' : ''">
            {{numeral(topic.count).format(topic.count > 1000 ? '0.0a' : '0')}}
          </div>
        </div>
        <div v-if="topic.device" class="text-xs line-clamp-1" :class="pendingDeletions[topic.path] ? 'text-white' : 'text-gray-400'">{{topic.node}}/{{topic.group}}</div>
        <div v-else class="text-xs line-clamp-1" :class="pendingDeletions[topic.path] ? 'text-white' : 'text-gray-400'">{{topic.group}}</div>
        <div class="text-xs mt-2 line-clamp-1" :class="pendingDeletions[topic.path] ? 'text-white' : 'text-gray-500'">{{dayjs(updatedTimes.find(e => e.path === topic.path).lastUpdated).fromNow()}}</div>
      </div>
    </div>
    <div class="flex items-center justify-center h-full" v-else>
      <div v-if="connected === false"
          class="bg-red-700 px-4 py-2 uppercase font-bold tracking-wider text-sm text-white mr-2">
        Not Connected
      </div>
    </div>
  </div>
</template>

<script>
import numeral from 'numeral'
import { ServiceClient, Topic } from '@amrc-factoryplus/service-client'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

export default {

  name: 'Monitor',

  computed: {
    dayjs () {
      return dayjs.extend(relativeTime)
    },
    relativeTime () {
      return relativeTime
    },
    latestUpdatedTopics () {
      return this.topics
    },
    // Computed property that depends on lastRefreshTime
    updatedTimes() {
      // Just referencing lastRefreshTime is enough to establish a dependency
      // The actual value of lastRefreshTime is not used, but changing it triggers re-computation
      return this.topics.map(topic => {
        return { ...topic, fromNow: dayjs(topic.lastUpdated).fromNow() };
      });
    }
  },

  mounted() {
    // Refresh lastRefreshTime every minute to force updates in computed properties
    setInterval(() => {
      this.lastRefreshTime = new Date().getTime();
    }, 1000); // Update every 60 seconds
  },

  methods: {

    createConnection () {
      this.connecting   = true
      const directories = this.directories.split(/\s+/)
      const username    = this.username
      const password    = this.password

      return Promise.all(directories.map(async directory_url => {
        const fplus = await new ServiceClient({
          directory_url,
          username,
          password,
          verbose: 'ALL',
          browser: true,
        }).init()

        this.mqtt = await fplus.MQTT.mqtt_client()

        this.mqtt.on('connect', this.onConnect)
        this.mqtt.on('error', e => console.log(`MQTT error: ${e}`))
        this.mqtt.on('message', this.onMessage)

        this.mqtt.subscribe('spBv1.0/#')

      }))
    },

    stop () {
      clearInterval(this.expiry_timer)
      if (!this.mqtt) return
      return new Promise((resolve, reject) => {
        this.mqtt.on('end', () => {
          this.connected = false
          clearInterval(this.sortTimer)
          resolve()
        })
        this.mqtt.end()
      })
    },

    onConnect () {
      this.connecting = false
      this.connected  = true

      // Set a timer to sort the topics by count every 5 seconds
      this.sortTimer = setInterval(() => {
        this.topics = this.topics.sort((a, b) => b.count - a.count)
      }, 5000)
    },

    onMessage (topicstr) {

      const topic = Topic.parse(topicstr);
      if (!topic) {
        console.log(`Bad MQTT topic ${topic}`);
        return;
      }

      const { address, type: kind } = topic;
      const { group, node, device } = address;


      const parts = [...group.split("-"), node];
      if (device != undefined) parts.push(device);
      const path = parts.join("/");

      if (kind === "DATA") {
        // If the topic is already in the list, update the count and flash it
        const topicIndex = this.topics.findIndex(e => e.path === path);
        if (topicIndex !== -1) {
          // Update count and lastUpdated
          this.topics[topicIndex].count++;
          this.topics[topicIndex].lastUpdated = Date.now();


          // If there's already a flash timeout for this path, clear it
          if (this.flashTimeouts[path]) {
            clearTimeout(this.flashTimeouts[path]);
            if (this.$refs[path] && this.$refs[path][0]) {
              this.$refs[path][0].classList.remove('bg-gray-700');
            }
          }

          // Apply flash effect and set a new timeout
          if (this.$refs[path] && this.$refs[path][0]) {
            this.$refs[path][0].classList.add('bg-gray-700');
            this.flashTimeouts[path] = setTimeout(() => {
              this.$refs[path][0].classList.remove('bg-gray-700');
              // Clean up after the timeout executes
              delete this.flashTimeouts[path];
            }, 200);
          }
        } else {
          // If the topic is not in the list, add it
          this.addTopic(path, group, node, device, kind);
        }
      }

      if (kind === "DEATH") {
        // If the topic is a 'DEATH' then mark it for removal, but allow for cancellation
        if (this.topics.some(e => e.path === path)) {
          this.$refs[path][0].classList.add('bg-red-800');

          // Store a cancellable timeout function
          // Mark this path for potential cancellation
          this.pendingDeletions[path] = setTimeout(() => {
            this.topics = this.topics.filter(e => e.path !== path);
            // Cleanup after deletion
            this.$refs[path][0]?.classList.remove('bg-red-800');
            delete this.pendingDeletions[path];
          }, 10000);
        }
      }

      if (kind === "BIRTH") {
        // If we have a pending death for this topic, cancel it
        if (this.pendingDeletions[path]) {
          clearTimeout(this.pendingDeletions[path]);
          delete this.pendingDeletions[path];
        }

        this.addTopic(path, group, node, device, kind);
      }


      if (kind === "CMD") {
        // If we have a command then flash the div yellow
        if (this.$refs[path]) {
          this.$refs[path][0].classList.add('bg-yellow-500');
          setTimeout(() => {
            this.$refs[path][0].classList.remove('bg-yellow-500');
          }, 200);
        }

        // Update the timestamp
        if (this.topics.some(e => e.path === path)) {
          this.topics.map(e => {
            if (e.path === path) {
              e.lastUpdated = Date.now();
            }
          });
        }
      }
    },

    addTopic (path, group, node, device) {

      // Add the topic if it doesn't already exist
      if (!this.topics.some(e => e.path === path)) {
        this.topics.push({
          path: path,
          group: group,
          node: node,
          device: device,
          count: 1,
          lastUpdated: Date.now(),
        });
      }

      // Flash the div
      if (this.$refs[path]) {
        // Remove the red background if it's there
        this.$refs[path][0]?.classList.remove('bg-red-800');
        this.$refs[path][0]?.classList.add('bg-green-500');
        setTimeout(() => {
          this.$refs[path][0]?.classList?.remove('bg-green-500');
        }, 1000);
      }
    },
  },

  data () {
    return {
      directories: 'https://directory.amrc-factoryplus-dev.shef.ac.uk',
      username: '***REMOVED***',
      password: '***REMOVED***',

      mqtt: null,

      topics: [],
      numeral: numeral,
      connected: false,
      connecting: false,
      pendingDeletions: {},
      flashTimeouts: {},
      lastRefreshTime: 0,
    }
  },
}
</script>

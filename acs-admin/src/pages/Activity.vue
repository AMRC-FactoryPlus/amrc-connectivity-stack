<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <div class="flex flex-col flex-1">
    <div v-if="s.loaded && connected" id="app"
        class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 w-full gap-1 p-1 line">
      <div class="rounded-lg" :key="topic.path" :ref="topic.path" v-for="topic in topics">
        <Card class="bg-transparent">
          <CardHeader class="flex flex-row items-center justify-between space-y-0 !pb-0">
            <CardTitle class="text-sm font-medium">
              <div v-if="topic.device"
                  class="text-xs line-clamp-1"
                  :class="pendingDeletions[topic.path] ? 'text-white' : 'text-gray-500'">{{topic.node}}/{{topic.group}}
              </div>
              <div v-else
                  class="text-xs line-clamp-1"
                  :class="pendingDeletions[topic.path] ? 'text-white' : 'text-gray-400'">{{topic.group}}
              </div>
            </CardTitle>
            <div class="flex-0 p-1 px-2 flex items-center justify-center text-xs" :class="topic.device ? 'ml-auto' : ''">
              {{numeral(topic.count).format(topic.count > 1000 ? '0.0a' : '0')}}
            </div>
          </CardHeader>
          <CardContent>
            <div class="text-md font-bold line-clamp-1">
              {{topic.device ?? topic.node}}
            </div>
            <div class="text-xs">
              <div class="text-xs mt-2 line-clamp-1"
                  :class="pendingDeletions[topic.path] ? 'text-white' : 'text-gray-400'">{{dayjs(
                  updatedTimes.find(e => e.path === topic.path).lastUpdated).fromNow()}}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    <div class="flex flex-col gap-2 items-center justify-center flex-1 animate-pulse" v-else>
      <div class="text-2xl font-semibold leading-none tracking-tight">Loading...</div>
      <div class="text-sm text-slate-500 dark:text-slate-400">The activity monitor is loading</div>
    </div>
  </div>
</template>

<script>
import numeral from 'numeral'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Topic } from '@amrc-factoryplus/service-client'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'

export default {

  name: 'Activity',

  setup () {
    return {
      s: useServiceClientStore(),
    }
  },

  components: {
    Card,
    CardDescription,
    CardFooter,
    CardContent,
    CardTitle,
    CardHeader,
  },

  computed: {
    dayjs () {
      return dayjs.extend(relativeTime)
    },
    numeral () {
      return numeral
    },
    relativeTime () {
      return relativeTime
    },
    latestUpdatedTopics () {
      return this.topics
    }, // Computed property that depends on lastRefreshTime
    updatedTimes () {
      // Just referencing lastRefreshTime is enough to establish a dependency
      // The actual value of lastRefreshTime is not used, but changing it triggers re-computation
      return this.topics.map(topic => {
        return {
          ...topic,
          fromNow: dayjs(topic.lastUpdated).fromNow(),
        }
      })
    },
  },

  async mounted () {
    // Refresh lastRefreshTime every minute to force updates in computed properties
    setInterval(() => {
      this.lastRefreshTime = new Date().getTime()
    }, 1000) // Update every 60 seconds

    this.mqtt = await this.s.client.MQTT.mqtt_client()

    this.mqtt.on('connect', this.onConnect)
    this.mqtt.on('error', e => console.log(`MQTT error: ${e}`))
    this.mqtt.on('message', this.onMessage)

    this.mqtt.subscribe('spBv1.0/#')
  },

  methods: {

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

      const topic = Topic.parse(topicstr)
      if (!topic) {
        console.log(`Bad MQTT topic ${topic}`)
        return
      }

      const {
              address,
              type: kind,
            } = topic
      const {
              group,
              node,
              device,
            } = address

      const parts = [...group.split('-'), node]
      if (device != undefined) parts.push(device)
      const path = parts.join('/')

      if (kind === 'DATA') {
        // If the topic is already in the list, update the count and flash it
        const topicIndex = this.topics.findIndex(e => e.path === path)
        if (topicIndex !== -1) {
          // Update count and lastUpdated
          this.topics[topicIndex].count++
          this.topics[topicIndex].lastUpdated = Date.now()

          // If there's already a flash timeout for this path, clear it
          if (this.flashTimeouts[path]) {
            clearTimeout(this.flashTimeouts[path])
            if (this.$refs[path] && this.$refs[path][0]) {
              this.$refs[path][0].classList.remove('bg-gray-200');
            }
          }

          // Apply flash effect and set a new timeout
          if (this.$refs[path] && this.$refs[path][0]) {
            this.$refs[path][0].classList.add('bg-gray-200');
            this.flashTimeouts[path] = setTimeout(() => {
              this.$refs[path][0].classList.remove('bg-gray-200');
              // Clean up after the timeout executes
              delete this.flashTimeouts[path]
            }, 200)
          }
        }
        else {
          // If the topic is not in the list, add it
          this.addTopic(path, group, node, device, kind)
        }
      }

      if (kind === 'DEATH') {
        // If the topic is a 'DEATH' then mark it for removal, but allow for cancellation
        if (this.topics.some(e => e.path === path)) {
          this.$refs[path][0].classList.add('bg-red-800');

          // Store a cancellable timeout function
          // Mark this path for potential cancellation
          this.pendingDeletions[path] = setTimeout(() => {
            this.topics = this.topics.filter(e => e.path !== path)
            // Cleanup after deletion
            this.$refs[path][0]?.classList.remove('bg-red-800');
            delete this.pendingDeletions[path]
          }, 10000)
        }
      }

      if (kind === 'BIRTH') {
        // If we have a pending death for this topic, cancel it
        if (this.pendingDeletions[path]) {
          clearTimeout(this.pendingDeletions[path])
          delete this.pendingDeletions[path]
        }

        this.addTopic(path, group, node, device, kind)
      }

      if (kind === 'CMD') {
        // If we have a command then flash the div yellow
        if (this.$refs[path]) {
          this.$refs[path][0].classList.add('bg-yellow-500');
          setTimeout(() => {
            this.$refs[path][0].classList.remove('bg-yellow-500');
          }, 200)
        }

        // Update the timestamp
        if (this.topics.some(e => e.path === path)) {
          this.topics.map(e => {
            if (e.path === path) {
              e.lastUpdated = Date.now()
            }
          })
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
        })
      }

      // Flash the div
      if (this.$refs[path]) {
        // Remove the red background if it's there
        this.$refs[path][0]?.classList.remove('bg-red-800');
        this.$refs[path][0]?.classList.add('bg-green-500');
        setTimeout(() => {
          this.$refs[path][0]?.classList?.remove('bg-green-500');
        }, 1000)
      }
    },
  },

  data () {
    return {
      topics: [],
      connected: false,
      connecting: false,
      pendingDeletions: {},
      flashTimeouts: {},
      lastRefreshTime: 0,
    }
  },
}
</script>

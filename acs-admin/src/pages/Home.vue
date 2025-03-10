<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div v-if="s.loaded" class="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>MQTT Server</CardDescription>
          <Copyable :text="mqttUrl">
            <CardTitle class="text-4xl">
              {{ mqttUrl }}
            </CardTitle>
          </Copyable>
        </CardHeader>
      </Card>
      <div class="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card class="sm:col-span-2">
          <CardHeader class="pb-3">
            <CardTitle>Graph</CardTitle>
            <CardDescription class="max-w-lg text-balance leading-relaxed">
              Visualise real-time data flow across the infrastructure in a graph view.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button as-child>
              <a :href="`${s.scheme}://visualiser.${s.baseUrl}`">View</a>
            </Button>
          </CardFooter>
        </Card>
        <Card class="sm:col-span-2">
          <CardHeader class="pb-3">
            <CardTitle>Activity</CardTitle>
            <CardDescription class="max-w-lg text-balance leading-relaxed">
              Visualise real-time data changes across the infrastructure in a table view.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <RouterLink to="/activity">
              <Button as-child>
                <a :href="`${s.scheme}://activity.${s.baseUrl}`">View</a>
              </Button>
            </RouterLink>
          </CardFooter>
        </Card>
      </div>
    </div>
  <div v-else class="flex flex-1 items-center justify-center">
    <Login/>
  </div>
</template>

<script>
import { Button } from '@components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import Login from '@/components/Login.vue'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'

export default {

  name: 'Home',

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
    Button,
    Skeleton,
    Login,
    Copyable
  },

  computed: {
    mqttUrl () {
      return this.s.urls?.mqtt?.[0] ?? null
    },
  },

  data () {
    return {
    }
  },
}
</script>

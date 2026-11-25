<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col gap-4">
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
      <div v-if="cards.length" class="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card v-for="card in cards" :key="card.key" class="sm:col-span-2">
          <CardHeader class="pb-3">
            <CardTitle>{{ card.title }}</CardTitle>
            <CardDescription class="max-w-lg text-balance leading-relaxed">
              {{ card.text }}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button as-child>
              <RouterLink v-if="card.to" :to="card.to">View</RouterLink>
              <a v-else :href="card.href(s)">View</a>
            </Button>
          </CardFooter>
        </Card>
      </div>
  </div>
</template>

<script>
import { Button } from '@components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import { useAccessStore } from '@store/useAccessStore.js'
import { home_cards } from '@/lib/access/home-cards.js'

export default {

  name: 'Home',

  setup () {
    return {
      s: useServiceClientStore(),
      access: useAccessStore(),
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
    Copyable
  },

  computed: {
    mqttUrl () {
      return this.s.urls?.MQTT?.[0] ?? null
    },

    /* Only the cards that lead somewhere the user can read. */
    cards () {
      return home_cards(this.access.check)
    },
  },

  data () {
    return {
    }
  },
}
</script>

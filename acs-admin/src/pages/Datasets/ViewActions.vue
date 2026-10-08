<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The right-hand toolbar shared by the timeline and the list:
     Timeline | List, Kiosk, New dataset. -->
<template>
  <div class="flex items-center gap-2">
    <Tabs :model-value="view" @update:model-value="v => emit('update:view', v)">
      <TabsList>
        <TabsTrigger value="timeline"><i class="fa-solid fa-bars-staggered mr-1.5"></i>Timeline</TabsTrigger>
        <TabsTrigger value="list"><i class="fa-solid fa-list mr-1.5"></i>List</TabsTrigger>
      </TabsList>
    </Tabs>
    <Button variant="outline" size="sm" @click="router.push('/kiosk')">
      <i class="fa-solid fa-tablet-screen-button mr-1.5"></i>Kiosk
    </Button>
    <Button size="sm" @click="router.push('/datasets/new')">
      <i class="fa-solid fa-plus mr-1.5"></i>New dataset
    </Button>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

defineProps({ view: { type: String, required: true } })
const emit = defineEmits(['update:view'])
const router = useRouter()
</script>

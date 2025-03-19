<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Card>
    <CardHeader class="w-full">
      <div class="flex items-center justify-between gap-1">
        <div class="flex flex-col gap-1">
          <h3 v-if="title" class="text-gray-500 text-sm flex items-center gap-1.5">
            <i v-if="titleIcon" :class="`fa-solid fa-${titleIcon} text-xs`"></i>
            <div>{{title}}</div>
          </h3>
          <slot></slot>
          <Copyable v-if="text" :text="text">
            <CardTitle :title="textTooltip" class="text-2xl">
              {{text}}
            </CardTitle>
          </Copyable>
          <Copyable v-if="detail" :text="detail">
            <div :title="detailTooltip"
                class="flex items-center justify-center gap-1 text-sm text-gray-600 hover:text-gray-950 bg-gray-100 px-1.5 py-0.5 rounded-md">
              <i v-if="detailIcon" :class="`fa-solid fa-${detailIcon}`"></i>
              <div>{{detail}}</div>
            </div>
          </Copyable>
        </div>
        <Button
            v-if="action"
            @click="action"
            :title="actionTooltip"
            variant="ghost"
            class="flex items-center gap-2">
          <i v-if="actionIcon" :class="`fa-solid fa-${actionIcon}`"></i>
          <div v-if="actionText">{{actionText}}</div>
        </Button>
      </div>
    </CardHeader>
  </Card>
</template>

<script>
import { Card, CardHeader, CardTitle } from '@components/ui/card/index.js'
import Copyable from '@components/Copyable.vue'
import { Button } from '@components/ui/button/index.js'

export default {

  name: 'DetailCard',
  components: {
    Button,
    Copyable,
    Card,
    CardHeader,
    CardTitle,
  },

  setup () {
    return {}
  },

  props: {
    title: {
      type: String,
      required: true,
    },
    titleIcon: {
      type: String,
      default: null,
    },
    text: {
      type: String,
      default: null,
    },
    textTooltip: {
      type: String,
      default: null,
    },
    detail: {
      type: String,
      default: null,
    },
    detailIcon: {
      type: String,
      default: null,
    },
    detailTooltip: {
      type: String,
      default: null,
    },
    action: {
      type: Function,
      default: null,
    },
    actionText: {
      type: String,
      default: null,
    },
    actionTooltip: {
      type: String,
      default: null,
    },
    actionIcon: {
      type: String,
      default: null,
    },
  }
}
</script>
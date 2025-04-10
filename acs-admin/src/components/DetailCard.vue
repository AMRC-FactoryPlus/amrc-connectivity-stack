<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Card>
    <CardHeader class="w-full">
      <div class="flex items-center justify-between gap-1">
        <div class="flex flex-col items-start gap-1">
          <div v-if="badge" class="flex mb-2">
            <div class="px-1.5 py-0.5 rounded-md bg-green-600 text-sm font-bold uppercase tracking-wide text-white">
              {{badge}}
            </div>
          </div>
          <h3 v-if="title" class="text-gray-500 text-sm flex items-center gap-1.5">
            <i v-if="titleIcon" :class="`fa-solid fa-${titleIcon} text-xs`"></i>
            <div>{{title}}</div>
          </h3>
          <slot></slot>
          <template v-if="text">
            <component :is="copyable ? 'Copyable' : 'div'" :text="text">
              <CardTitle :title="textTooltip">
                <div class="flex justify-center items-center gap-2">
                  <i v-if="icon" :class="`fa-solid fa-${icon} text-sm mt-1`"></i>
                  <div class="text-2xl">{{text}}</div>
                </div>
              </CardTitle>
            </component>
          </template>
          <slot name="subtitle"></slot>
          <div v-if="subtitle" class="text-gray-500 text-sm max-w-xl">{{subtitle}}</div>
          <component :is="copyable ? 'Copyable' : 'div'" v-if="detail" :text="detail" class="flex items-center">
            <div :title="detailTooltip"
                class="flex items-center justify-center gap-1 text-xs text-gray-950 bg-gray-100 px-1.5 py-0.5 rounded-md opacity-60 hover:opacity-100">
              <i v-if="detailIcon" :class="`fa-solid fa-${detailIcon}`"></i>
              <div>{{detail}}</div>
            </div>
          </component>
          <component :is="copyable ? 'Copyable' : 'div'" v-if="secondDetail" :text="secondDetail" class="flex items-center">
            <div :title="secondDetailTooltip"
                class="flex items-center justify-center gap-1 text-xs text-gray-950 bg-gray-100 px-1.5 py-0.5 rounded-md opacity-60 hover:opacity-100">
              <i v-if="secondDetailIcon" :class="`fa-solid fa-${secondDetailIcon}`"></i>
              <div>{{secondDetail}}</div>
            </div>
          </component>
        </div>
        <slot name="action"></slot>
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
    badge: String,
    title: String,
    subtitle: String,
    titleIcon: String,
    icon: String,
    text: String,
    textTooltip: String,
    detail: String,
    detailTooltip: String,
    detailIcon: String,
    secondDetail: String,
    secondDetailTooltip: String,
    secondDetailIcon: String,
    action: Function,
    actionText: String,
    actionTooltip: String,
    actionIcon: String,
    copyable: {
      type: Boolean,
      default: true
    }
  }
}
</script>
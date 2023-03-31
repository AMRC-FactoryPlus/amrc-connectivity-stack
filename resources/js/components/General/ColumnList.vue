<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="col-span-1 flex-grow flex flex-col overflow-y-hidden bg-white" :class="[showDivider ? 'border-r' : '']">
    <div class="flex items-center">
      <div v-if="name" class="pt-4 pb-2 flex items-center justify-between flex-1">
        <div class="flex flex-col">
          <h2 class="font-bold text-brand ml-3">
            {{ name }}
          </h2>
          <h4 v-if="description" class="text-gray-500 ml-3">
            {{ description }} <span @click="$emit('descriptionAction')"
                                    class="hover:underline text-brand cursor-pointer">{{ descriptionAction }}</span>
          </h4>
        </div>
        <div class="flex mt-0 ml-4">
          <slot name="actions"></slot>
          <div v-if="$root.$data.user.administrator" class="">
            <slot name="admin-actions"></slot>
          </div>
        </div>
      </div>
    </div>
    <div class="flex-grow flex flex-col overflow-y-auto">
      <search v-if="showSearch" :property="property" :loading="loading"></search>
      <div v-if="loading" class="animate-pulse">
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
        <div class="m-3 bg-gray-100  h-12"></div>
      </div>
      <div class="flex-grow flex flex-col overflow-y-auto" v-else>
        <div ref="content" id="content" class="overflow-y-auto flex flex-col flex-grow">
          <li v-for="(item, index)  in items" class="col-span-1 flex">
            <button @click="$emit('selected', item)"
                    class="flex-1 flex items-center justify-between text-left bg-white truncate mt-2 hover:!bg-gray-100"
                    :class="selectedItem === item[selectedItemKey] ? '!bg-gray-100' : ''">
              <slot name="item" :item="item" :index="index"></slot>
            </button>
          </li>
          <slot v-if="items?.length === 0" name="empty"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import search from "@/resources/js/components/General/Search.vue";

export default {
  name: 'ColumnList',
  computed: {
    search() {
      return search
    }
  },

  components: {
    'search': () => import(/* webpackPrefetch: true */ './Search.vue'),
  },

  props: {
    name: {},
    description: {},
    descriptionAction: {},
    property: {required: true},
    items: {required: true},
    loading: {required: true, type: Boolean},
    selectedItem: {required: false, default: null},
    selectedItemKey: {required: false, default: 'id', type: String},
    showDivider: {default: true},
    showSearch: {required: false, default: true, type: Boolean}
  },
};
</script>


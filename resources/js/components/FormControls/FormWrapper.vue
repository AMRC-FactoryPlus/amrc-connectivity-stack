<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
    <div class="grid grid-cols-3 gap-10 flex-grow">
        <div v-if="showDescription" class="col-span-1 text-sm text-gray-400 my-auto mt-7">
            {{ control.description }}
        </div>
        <div class="flex flex-col" :class="[showDescription ? 'col-span-2' : 'col-span-3']">
            <div class="flex items-center mb-2">
                <h4 v-if="control.name">{{ control.name }}</h4>
                <button v-if="control.infoLink" @mouseup="goto_url_tab(control.infoLink)"
                        v-tooltip="control.infoTooltip" class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></button>
                <i v-else-if="control.infoTooltip"
                   v-tooltip="control.infoTooltip" class="fa-sharp fa-solid fa-info-circle fa-fw fpl-button-info text-xs"></i>
            </div>
            <div class="flex w-full relative">
                <slot></slot>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: "FormWrapper",

    components: {},

    props: {
        showDescription: {
            type: Boolean,
            default: true,
        },
        control: {},
    },

    watch: {},

    computed: {},

    mounted() {
    },

    methods: {},

    data() {
        return {};
    },
}
</script>

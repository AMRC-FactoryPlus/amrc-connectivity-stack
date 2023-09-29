<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
    <div :key="this.selectedMetric.namePath.join('/')" v-if="schema && schemaLoading === false"
         class="flex flex-col p-4">
        <div class="grid grid-cols-2 gap-10 mb-6">
            <div class="flex flex-col">
                <div class="font-light text-sm text-gray-300 mb-2">{{ selectedMetric.namePath.join(' / ') }}</div>
                <div class="font-bold text-lg text-gray-600">{{ selectedMetric.namePath.slice(-1)[0] }}</div>
                <input class="font-light text-sm text-gray-400 w-full focus:outline-none focus:bg-gray-50 focus:p-1 mr-3 group"
                       v-model="localModel.Documentation"></input>
            </div>
            <Checkbox v-model="localModel.Record_To_Historian"
                      :valid="{}"
                      :control="{
                        name: 'Record to Historian',
                        description: schema.properties.Record_To_Historian.description
            }"/>
        </div>
        <div class="grid gap-y-3">
            <Wrapper>
                <template #description>
                    {{ schema.properties.Value.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: 'Value',
        }" :valid="{}" v-model="localModel.Value"></Input>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Sparkplug_Type.description }}
                </template>
                <template #content>
                    <Dropdown
                            :class="isValidType(localModel.Sparkplug_Type, availableTypes) ? '' : 'bg-red-200 p-4'"
                            v-model="localModel.Sparkplug_Type"
                            :valid="{}"
                            :control="{
              name: schema.properties.Sparkplug_Type.title,
              options: availableTypes
            }"></Dropdown>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Method.description }}
                </template>
                <template #content>
                    <Dropdown
                            v-model="localModel.Method"
                            :valid="{}"
                            :control="{
              name: schema.properties.Method.title,
              options: methods
            }"></Dropdown>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Address.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: schema.properties.Address.title,
        }" :valid="{}" v-model="localModel.Address"></Input>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Path.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: schema.properties.Path.title,
        }" :valid="{}" v-model="localModel.Path"></Input>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Eng_Unit.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: 'Engineering Unit',
        }" :valid="{}" v-model="localModel.Eng_Unit"></Input>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Eng_Low.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: 'Eng Low',
        }" :valid="{}" v-model="localModel.Eng_Low"></Input>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Eng_High.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: 'Eng High',
        }" :valid="{}" v-model="localModel.Eng_High"></Input>
                </template>
            </Wrapper>
            <Wrapper>
                <template #description>
                    {{ schema.properties.Deadband.description }}
                </template>
                <template #content>
                    <Input :showDescription="false" :control="{
          name: 'Deadband',
        }" :valid="{}" v-model="localModel.Deadband"></Input>
                </template>
            </Wrapper>

        </div>
    </div>
</template>

<script>
export default {
    name: 'SparkplugMetric',
    props: {
        selectedMetric: {
            required: true,
            type: Object,
        },
        model: {
            required: true,
            type: Object,
        },
    },
    watch: {
        selectedMetric: {
            handler(val) {
                this.populateForm()
            }, deep: true,
        },

        localModel: {
            handler(val) {
                let newObject = Object.assign({}, val)
                Object.keys(newObject).forEach(key => {
                    if (newObject[key] === null) {
                        delete newObject[key]
                    }
                })
                this.$emit('input', newObject)
            }, deep: true,
        },
    },
    components: {
        'Dropdown': () => import(/* webpackPrefetch: true */ '../../FormControls/Dropdown.vue'),
        'Checkbox': () => import(/* webpackPrefetch: true */ '../../FormControls/Checkbox.vue'),
    },
    computed: {
        availableTypes() {
            return this.selectedMetric.metric.properties.Sparkplug_Type.enum.map(e => {
                return {
                    title: e === '' ? 'None' : e,
                    value: e,
                }
            })
        },
    },
    mounted() {
        this.schemaLoading = true
        axios.post('/api/github-proxy/', {
            path: 'Common/Metric-v1.json'
        }).then(k => {
            let data = k.data
            this.methods = data.data.properties.Method.enum.map(e => {
                return {
                    title: e === '' ? 'None' : e,
                    value: e,
                }
            })
            this.schema = data.data
            this.schemaLoading = false
        }).catch(error => {
            this.posting = false
            if (error && error.response && error.response.status === 401) {
                this.goto_url('/login')
            }
            this.handleError(error)
        })

        this.populateForm()
    },
    methods: {
        populateForm() {

            // Get the existing properties defined for this metric from the master model
            let existing = this.get(this.selectedMetric.namePath.join('/'), this.model, '/')

            // Loop through the properties and set the values to the existing values or the default
            Object.keys(this.selectedMetric.metric.properties).forEach(e => {

                // If we already have one in the master model then use that
                if (existing && e in existing) {

                    // If the property that we're dealing with is the Sparkplug_Type then we need to ensure that it's a valid type, otherwise set the default
                    if (e === 'Sparkplug_Type') {
                        if (this.isValidType(existing[e], this.selectedMetric.metric.properties[e].enum)) {
                            this.$set(this.localModel, e, existing[e])
                        } else {
                            if ('default' in this.selectedMetric.metric.properties[e]) {
                                // If we have a default value then set it
                                this.$set(this.localModel, e, this.selectedMetric.metric.properties[e].default)
                            } else if ('enum' in this.selectedMetric.metric.properties[e]) {
                                // If we have an enum then set the first value
                                this.$set(this.localModel, e, this.selectedMetric.metric.properties[e].enum[0])
                            }
                        }
                    } else {
                        this.$set(this.localModel, e, existing[e]);
                    }
                }

                // Otherwise set it to the default
                else if ('default' in this.selectedMetric.metric.properties[e]) {
                    // If we have a default value then set it
                    this.$set(this.localModel, e, this.selectedMetric.metric.properties[e].default)
                } else if ('enum' in this.selectedMetric.metric.properties[e]) {
                    // If we have an enum then set the first value
                    this.$set(this.localModel, e, this.selectedMetric.metric.properties[e].enum[0])
                } else {
                    // Otherwise set it to null
                    this.$set(this.localModel, e, null)
                }
            })
        },

        isValidType(val, options) {
            return options.some(e => e.value === val)
        },

        get(path, onObject, delimiter = '.') {
            let schema = onObject  // a moving reference to internal objects within obj
            const pList = path.split(delimiter)
            const len = pList.length
            for (let i = 0; i < len - 1; i++) {
                const elem = pList[i]
                if (!schema[elem]) schema[elem] = {}
                schema = schema[elem]
            }
            return schema[pList[len - 1]]
        },
    },
    data() {
        return {
            localModel: {},
            schema: null,
            schemaLoading: true,
            methods: [],
        }
    },
}
</script>


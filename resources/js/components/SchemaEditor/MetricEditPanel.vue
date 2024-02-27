<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div v-if="selectedMetric && localMetric">
    <Wrapper v-if="metricSchema">
      <template #description>
        The name of the metric
      </template>
      <template #content>
        <div class="p-4 w-full">
          <Input :showDescription="false"
                 :control="{name: 'Name',}"
                 :valid="{}"
                 :value="localName"
                 @input="updateMetricName"
          ></Input>
        </div>
      </template>
    </Wrapper>
    <Wrapper v-if="metricSchema && types">
      <template #description>
        {{metricSchema.properties.Sparkplug_Type.description}}
      </template>
      <template #content>
        <Dropdown
            multi
            class="p-4"
            v-model="localMetric.Sparkplug_Type.enum"
            :valid="{}"
            :control="{
              name: metricSchema.properties.Sparkplug_Type.title,
              options: availableTypes
            }"></Dropdown>
      </template>
    </Wrapper>
    <Wrapper v-if="metricSchema">
      <template #description>{{metricSchema.properties.Documentation.description}}</template>
      <template #content>
        <div class="p-4 w-full">
          <Input :showDescription="false"
                 :control="{name: 'Description',}"
                 :valid="{}"
                 v-model="localMetric.Documentation.default"
          ></Input>
        </div>
      </template>
    </Wrapper>
    <Wrapper v-if="metricSchema">
      <template #description>{{metricSchema.properties.Eng_Unit?.description}}</template>
      <template #content>
        <div class="p-4 w-full">
          <Input :showDescription="false"
                 :control="{name: 'Engineering Unit',}"
                 :valid="{}"
                 v-model="localMetric.Eng_Unit.default"
          ></Input>
        </div>
      </template>
    </Wrapper>
    <Wrapper v-if="metricSchema">
      <template #description>{{metricSchema.properties.Eng_Low?.description}}</template>
      <template #content>
        <div class="p-4 w-full">
          <Input :showDescription="false"
                 :control="{name: 'Low',}"
                 :valid="{}"
                 :value="localMetric.Eng_Low.default" @input="(val) => {localMetric.Eng_Low.default = Number(val)}"
          ></Input>
        </div>
      </template>
    </Wrapper>
    <Wrapper v-if="metricSchema">
      <template #description>{{metricSchema.properties.Eng_High?.description}}</template>
      <template #content>
        <div class="p-4 w-full">
          <Input :showDescription="false"
                 :control="{name: 'High',}"
                 :valid="{}"
                 :value="localMetric.Eng_High.default" @input="(val) => {localMetric.Eng_High.default = Number(val)}"
          ></Input>
        </div>
      </template>
    </Wrapper>


  </div>
</template>

<script>
export default {

  name: 'MetricEditPanel',

  components: {
    'Dropdown': () => import(/* webpackPrefetch: true */ '../FormControls/Dropdown.vue'),
  },

  props: {
    /**
     * The details of the metric
     */
    selectedMetric: {
      type: Object,
      default: () => {
        return {}
      },
    },
  },

  mounted () {
    axios.post('/api/github-proxy/', {
      path: 'Common/Metric-v1.json',
    }).then(k => {
      let data = k.data
      this.metricSchema = data.data
    }).catch(error => {
      if (error && error.response && error.response.status === 401) {
        this.goto_url('/login')
      }
      this.handleError(error)
    })
    axios.post('/api/github-proxy/', {
      path: 'Common/Types/Sparkplug_Types-v1.json',
    }).then(k => {
      let data = k.data
      this.types = data.data.enum
    }).catch(error => {
      if (error && error.response && error.response.status === 401) {
        this.goto_url('/login')
      }
      this.handleError(error)
    })
    this.selectMetric()
  },

  watch: {
    'selectedMetric.uuid': {
      handler (val) {
        this.selectMetric()
      },
    },

    localMetric: {
      handler (val) {
        this.$emit('updateMetric', {
          ...this.selectedMetric,
          ...{
            property: {
              allOf: [
                {
                  $ref: 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Common/Metric-v1.json',
                },
                {
                  properties: val,
                },
              ],
            },
          },
        })
      }, deep: true,
    },

  },

  computed: {
    availableTypes () {
      return this.types.map(e => {
        return {
          title: e,
          value: e,
        }
      })
    },
  },

  methods: {
    isValidType (val, options) {
      return options.some(e => e.value === val)
    },

    updateMetricName (e) {
      this.localName = e
      this.$emit('updateMetricName', this.localName)
    },

    selectMetric () {
      this.localName = this.selectedMetric?.name
      this.localUuid = this.selectedMetric?.uuid
      this.localMetric = {
        ...{
          Documentation: {
            default: '',
          },
          Sparkplug_Type: {
            default: ['String'],
          },
          Eng_Unit: {
            default: '',
          },
          Eng_Low: {
            default: '',
          },
          Eng_High: {
            default: '',
          },
        },
        ..._.cloneDeep(this.selectedMetric.property.allOf[1].properties),
      }
    },
  },

  data () {
    return {
      localName: this.selectedMetric?.name,
      localUuid: this.selectedMetric?.uuid,
      localMetric: null,
      metricSchema: null,
      types: null,
    }
  },
}
</script>


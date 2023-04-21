<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
    <div class="flex flex-col flex-grow flex h-page overflow-y-auto">
        <div v-if="loadingExistingConfig" class="flex flex-grow w-full gap-x-6">
            <div class="flex items-center justify-center flex-grow">
                <div class="text-center mt-10 pb-3 flex-grow">
                    <i class="fa-sharp fa-solid fa-circle-notch fa-spin fa-2x text-gray-300"></i>
                    <h3 class="mt-2 text-sm font-medium text-gray-700">Just a second...</h3>
                    <p class="mt-1 text-sm text-gray-400">We're loading the existing configuration for this device</p>
                </div>
            </div>
        </div>
        <div v-else-if="loading" class="flex flex-grow w-full gap-x-6">
            <div class="flex items-center justify-center flex-grow">
                <div class="text-center mt-10 pb-3 flex-grow">
                    <i class="fa-sharp fa-solid fa-circle-notch fa-spin fa-2x text-gray-300"></i>
                    <h3 class="mt-2 text-sm font-medium text-gray-700">Validating schema...</h3>
                    <p class="mt-1 text-sm text-gray-400">Sorry this takes so long. I know, it's frustrating.</p>
                </div>
            </div>
        </div>
        <div v-else-if="schema === null" class="flex flex-grow w-full gap-x-6">
            <div class="flex items-center justify-center flex-grow">
                <div class="text-center mt-10 pb-3 flex-grow">
                    <i class="fa-sharp fa-solid fa-cogs fa-2x text-gray-500"></i>
                    <h3 class="mt-2 text-sm font-medium text-gray-700">What is<span
                            class="font-bold">{{ device.device_id || 'this device' }}</span>?
                    </h3>
                    <p class="mt-1 text-sm text-gray-400">Get started by assigning this device a schema.</p>
                    <div class="mt-6">
                        <button type="button" @click.stop="schemaBrowserVisible=true"
                                class="fpl-button-brand h-10 px-3 mr-1">
                            <div class="mr-2">Choose a Device Schema</div>
                            <i class="fa-sharp fa-solid fa-plus text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>
            <schema-browser-overlay :show="schemaBrowserVisible" @close="schemaBrowserVisible=false"
                                    :device-schemas="deviceSchemas"
                                    :device-schema-versions="deviceSchemaVersions"
                                    @schema-selected="selectSchema"></schema-browser-overlay>
        </div>
        <div class="flex flex-col flex-grow overflow-auto" v-else>
            <keep-alive>
                <cds-import-overlay :schema="metrics" :show="showCDSImport" @close="showCDSImport=false"
                                    :rerender-trigger="rerenderTrigger"
                                    @save="applyMapping"></cds-import-overlay>
            </keep-alive>
            <div class="flex justify-between items-center w-full">
                <h2 v-if="schema" class="font-bold text-brand p-3">{{ schema.title }}</h2>
                <button @click="showCDSImport = true" class="fpl-button-brand h-10 mx-1">
                    <span>Import CDS</span>
                    <i class="fa-sharp fa-solid fa-file-import ml-2"></i>
                </button>
            </div>
            <div class="flex flex-grow overflow-auto">
                <div class="flex flex-col overflow-y-auto flex-shrink-0 w-1/4">
                    <SchemaGroup :key="rerenderTrigger" @selected="selectMetric" @add="addObject"
                                 class="overflow-x-auto border-l-0" :metrics="metrics"
                                 :selected-metric="selectedMetric" :model="model"></SchemaGroup>
                    <div v-if="!loading"
                         class="flex items-center justify-center p-3 grid grid-cols-1 mt-auto transition-all">
                        <button v-if="isDirty" @click="save(true)" class="fpl-button-error h-10 ml-2"
                                :class="loading ? '!bg-opacity-50' : ''">
                            <span>Save Changes</span>
                            <i class="fa-sharp fa-solid fa-save ml-2"></i>
                        </button>
                    </div>
                    <div v-else class="flex items-center justify-center p-3 mt-auto transition-all">
                        <button disabled class="fpl-button-brand h-10 ml-2 w-full cursor-not-allowed opacity-50">
                            <span>Validating</span>
                            <i class="fa-sharp fa-solid fa-circle-notch fa-spin ml-2"></i>
                        </button>
                    </div>
                </div>
                <div v-if="selectedMetric" class="flex flex-col h-full overflow-y-auto border-l">
                    <SparkplugMetric :key="rerenderTrigger" :selected-metric="selectedMetric" :model="model"
                                     @input="metricDetailsEdited"></SparkplugMetric>
                </div>
                <div v-else class="flex flex-grow w-full gap-x-6">
                    <div class="flex items-center justify-center flex-grow">
                        <div class="text-center mt-10 pb-3 flex-grow">
                            <i class="fas fa-tag fa-2x text-gray-500"></i>
                            <h3 class="mt-2 text-sm font-medium text-gray-700">No Metric Selected</h3>
                            <p class="mt-1 text-sm text-gray-400">Click on a metric on the left to configure it.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
<script>
import {
    v4 as uuidv4,
} from 'uuid'
import $RefParser
    from '@apidevtools/json-schema-ref-parser'

export default {
    name: 'DeviceEditorOriginMapTab',

    props: {
        device: {required: true},
        deviceSchemas: {required: true},
        deviceSchemaVersions: {required: true},
    },

    components: {
        'schema-browser-overlay': () => import(/* webpackPrefetch: true */ '../Schemas/SchemaBrowserOverlay.vue'),
        'cds-import-overlay': () => import(/* webpackPrefetch: true */ '../Schemas/CDSImportOverlay.vue'),
        'SchemaGroup': () => import(/* webpackPrefetch: true */ './Schemas/SchemaGroup.vue'),
        'SparkplugMetric': () => import(/* webpackPrefetch: true */ './Schemas/SparkplugMetric.vue'),
    },

    mounted() {
        // Prevent the window from reloading if we have a dirty state
        window.onbeforeunload = this.checkDirty

        document.addEventListener('keydown', this.doSave)
        this.loadExistingConfig()
    },

    beforeDestroy() {
        document.removeEventListener('keydown', this.doSave)
    },

    methods: {

        checkDirty() {
            if (this.isDirty) {
                return ''
            }
        },

        loadExistingConfig() {
            this.loadingExistingConfig = true
            if (!this.device.latest_origin_map) {
                this.loadingExistingConfig = false
                return
            }

            // 1. Get the latest version of the schema from the model
            // TODO: Add a button to sync to latest model later? This will rebuild and merge metrics.
            let schemaObj = {
                url: this.device.latest_origin_map.schema_version.schema.url + '-v' + this.device.latest_origin_map.schema_version.version + '.json',
                device_schema_id: this.device.latest_origin_map.schema_version.device_schema_id,
                device_schema_version_id: this.device.latest_origin_map.device_schema_version_id,
            }
            this.refParser.dereference(schemaObj.url, (err, parsedSchema) => {
                if (err) {
                    console.error(err)
                } else {
                    this.selectSchema({
                        parsedSchema: parsedSchema,
                        schemaObj: schemaObj,
                    }, false)
                }
            })

            // 2. Load the metric object
            this.metrics = this.device.metrics

            // 3. Load the model object
            this.model = this.device.model
        },

        applyMapping(mapping) {
            this.showCDSImport = false


            Object.keys(mapping).forEach(e => {
                this.set(mapping[e].schemaMapping.namePath.join('/'), this.renameKeys(mapping[e]), this.model, '/')
            })

            this.markDirty()
        },

        doSave(e) {
            if (!((e.keyCode === 83 && e.metaKey) || (e.keyCode === 83 && e.ctrlKey))) {
                return
            }

            e.preventDefault()
            this.save(false)
        },

        /**
         * This function takes the old CDS metric names and remaps them into ones understood by this schema editor.
         * It also checks that the Sparkplug type is valid and utilises the default if not.
         */
        renameKeys(e) {
            return {
                Address: e.metric.address ?? null,
                Deadband: e.metric.deadBand ?? null,
                Documentation: e.metric.docs ?? null,
                Eng_High: e.metric.engHigh ?? null,
                Eng_Low: e.metric.engLow ?? null,
                Eng_Unit: e.metric.engUnit ?? null,
                Method: e.metric.method ?? null,
                Path: e.metric.path ?? null,
                Record_To_Historian: e.metric.recordToDB ?? null,
                Sparkplug_Type: this.validateType(this.remapTypes(e.metric.type) ?? null, e),
                Value: e.metric.value ?? null,
            }
        },

        validateType(type, mapping) {

            // Get valid types from the schema
            let validTypes = mapping.schemaMapping.metric.properties.Sparkplug_Type.enum;

            if (validTypes.includes(type)) {
                // If the type is valid, return it
                return type;
            } else {
                // Set the first valid type as the default
                return validTypes[0];
            }
        },

        remapTypes(oldType) {

            switch (oldType) {
                case 'Boolean':
                    return 'Boolean'

                case 'uInt8':
                    return 'UInt16BE'
                case 'int8':
                    return 'UInt16BE'

                case 'uInt16BE':
                    return 'UInt16BE'
                case 'uInt16LE':
                    return 'UInt16LE'
                case 'int16BE':
                    return 'Int16BE'
                case 'int16LE':
                    return 'Int16LE'

                case 'uInt32BE':
                    return 'UInt32BE'
                case 'uInt32LE':
                    return 'UInt32LE'
                case 'int32BE':
                    return 'Int32BE'
                case 'int32LE':
                    return 'Int32LE'

                case 'uInt64BE':
                    return 'UInt64BE'
                case 'uInt64LE':
                    return 'UInt64LE'
                case 'int64BE':
                    return 'Int64BE'
                case 'int64LE':
                    return 'Int64LE'

                case 'FloatBE':
                    return 'FloatBE'
                case 'FloatLE':
                    return 'FloatLE'

                case 'DoubleBE':
                    return 'DoubleBE'
                case 'DoubleLE':
                    return 'DoubleLE'

                case 'DateTime':
                    return 'DateTime'
                case 'String':
                    return 'String'
                case 'uuid':
                    return 'UUID'
                case 'dataSet':
                    return 'DataSet'
                case 'bytes':
                    return 'Bytes'
                case 'file':
                    return 'File'
                case 'Unknown':
                    return 'Unknown'
                default:
                    return 'String'
            }
        },

        /**
         * This function adds a new instance of an object represented in the schema by patternProperties.
         */
        addObject(val) {

            // Where to go to get the object to instantiate (the template)
            let templateLocation = Array.from(val.location)
            // Get the template object from the schema. This is the schema of the object.
            let objectToInstantiate = this.get(val.location.join('/'), this.schema, '/')

            // Where to put the new object
            let destinationLocation = Array.from(val.reference)

            // console.log('templateLocation', templateLocation);
            // console.log('destinationLocation', destinationLocation);
            // console.log('objectToInstantiate (before merging)', objectToInstantiate);

            if ('allOf' in objectToInstantiate) {
                // console.log('Needs merging. Starting...');
                if (objectToInstantiate.allOf.length !== 2) {
                    console.error('Metric requires merging to instantiate but is not configured correctly. To override, it must be contained within an allOf and have a second element specifying the overrides.', objectToInstantiate)
                    return
                }
                // Merge the objects, favouring the overwrites
                Object.keys(objectToInstantiate.allOf[1].properties).forEach(index => {
                    objectToInstantiate.allOf[0].properties[index] = objectToInstantiate.allOf[1].properties[index]
                })
            }

            // Modify the location to replace the regex with the name of the new object
            destinationLocation.splice((destinationLocation.indexOf('patternProperties')), 2, val.name)

            // console.log('destinationLocation after splicing', destinationLocation);

            // console.log('Giving to generateMetrics', objectToInstantiate, templateLocation, destinationLocation);

            // console.log('Creating metrics using this as the template base', templateLocation);

            // Pass to generateMetrics
            this.generateMetrics(objectToInstantiate, templateLocation, destinationLocation)
            this.rerenderTrigger = +new Date()
            this.markDirty('New Object')
        },

        selectMetric(val) {
            this.selectedMetric = val
        },

        metricDetailsEdited(val) {
            this.markDirty('Metric edited')
            this.set(this.selectedMetric.namePath.join('/'), val, this.model, '/')
        },

        markDirty() {
            this.isDirty = true
        },

        /**
         * This function takes the schema and builds up the metrics object. Each level of the metrics object has a $meta key that contains a keyPath and a namePath.
         *
         * keyPath is a reference to where the object exists within the schema object
         * namePath is a human-readable friendly name to illustrate the nesting of the metric
         *
         * @param obj
         * @param keyPath
         * @param destinationKeyPath
         * @param keyToReplaceWithRegexNesting
         * @returns {*}
         */
        generateMetrics(obj, keyPath = [], destinationKeyPath = null) {

            // destinationKeyPath is the keyPath without the patternProperties and regex

            let keyPathToWriteTo = destinationKeyPath ? destinationKeyPath : keyPath

            if (obj && typeof obj === 'object') {

                Object.keys(obj).forEach(k => {
                    let value = obj[k]

                    let flatPath = Array.from(keyPathToWriteTo)
                    // Here we remove allOf/<I> to flatten any allOf
                    flatPath.forEach((e, i) => {
                        if (e === 'allOf') {
                            flatPath.splice(i, 2)
                        }
                    })

                    // Detect metric signature
                    if (k === '$id' && value === 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Common/Metric-v1.json') {

                        // /**
                        //  * When we have metrics we position them within an 'allOf' so that we can more explicitly define the Sparkplug type. Here we move up two levels so
                        //  * that we can get the allOf object once we've found a v1 metric signature. Then, we merge the two, favouring the overwritten specification.
                        //  */

                        let metricPath = keyPath.slice(0, -1)
                        if (metricPath[metricPath.length - 1] !== 'allOf') {
                            console.error('Metric not configured correctly. It must be contained within an allOf and have a second element specifying the Sparkplug type.', metricPath)
                            return
                        }

                        let allOf = this.get(metricPath.join('/'), this.schema, '/')
                        if (allOf.length !== 2) {
                            console.error('Metric not configured correctly. It must be contained within an allOf and have a second element specifying the Sparkplug type.', metricPath)
                            return
                        }

                        Object.keys(allOf[1].properties).forEach(index => {
                            allOf[0].properties[index] = allOf[1].properties[index]
                        })

                        let namePath = flatPath.filter(e => e !== 'properties')

                        this.set(namePath.join('/'), {
                            metric: JSON.parse(JSON.stringify(allOf[0])),
                            keyPath: Array.from(keyPathToWriteTo),
                            namePath: Array.from(namePath),

                            // Uncomment this to enable Schema_UUID on metrics
                            // '$meta': {
                            //   Schema_UUID: JSON.parse(JSON.stringify(allOf[0])).properties.Schema_UUID.const
                            // },

                        }, this.metrics, '/')

                        // Once we realise that we're in a metric we don't need meta for the other sibling folders.
                        return obj

                    }

                    // If we haven't found a metric but we're still an object then keep digging
                    else if (typeof value === 'object') {

                        let processMeta = true

                        // Don't generate meta for metric overloads (allOf[1]). Check if allOf[0] is a metric
                        let metricPath = keyPath.slice(0, -1)
                        if (metricPath[metricPath.length - 1] === 'allOf' && metricPath[metricPath.length - 1][0]) {
                            let allOf = this.get(metricPath.join('/'), this.schema, '/')
                            if ('$id' in allOf[0] && allOf[0]['$id'] === 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Common/Metric-v1.json') {
                                // console.log('Not processing $meta for', allOf, metricPath.join('/'));
                                processMeta = false
                                return obj
                            }
                        }

                        // Do not process meta for certain keywords
                        if (['allOf', 'required'].includes(k)) {
                            processMeta = false
                        }

                        /* Only generate $meta if we're not part of an allOf. The metrics within the allOf entry will get meta, but since they have already been relocated
                        we don't need to worry about their orphaned shell objects */
                        if (Array.from(keyPathToWriteTo)[Array.from(keyPathToWriteTo).length - 1] === 'allOf') {
                            processMeta = false
                        }

                        if (processMeta) {
                            let metaPath = (flatPath.filter(e => e !== 'properties').join('/') + (['properties'].includes(k) ? '' : ('/' + k)) + '/$meta').replace(/^\/|\/$/g, '')

                            this.set(metaPath, {
                                keyPath: Array.from(keyPath),
                                namePath: flatPath,
                                Schema_UUID: ('Schema_UUID' in value) ? value.Schema_UUID.const : null,
                            }, this.metrics, '/')
                        }

                        keyPath.push(k)
                        if (destinationKeyPath) {
                            destinationKeyPath.push(k)
                        }
                        this.generateMetrics(value, keyPath, destinationKeyPath)
                        if (destinationKeyPath) {
                            destinationKeyPath.pop()
                        }
                        keyPath.pop()
                    }
                })
            }
            return obj
        },

        prepareModelForSaving() {
            // Set the top level Schema_UUID
            this.model.Schema_UUID = this.schema.properties.Schema_UUID.const

            // Set the top level Instance_UUID if it doesn't already exist
            if (!this.model.Instance_UUID) {
                this.set('Instance_UUID', uuidv4(), this.model)
            }

            this.appendUUIDs(this.model)
        },

        /**
         * This function recursively goes through all keys in the model and looks them up in the metrics object to see
         * which ones have a Schema_UUID key set in the $meta object and then uses the namePath object to set it on the instance.
         * It also generates Instance_UUIDs if none exist on the model.
         * @param obj
         * @param keyPath
         * @returns {*}
         */
        appendUUIDs(obj, keyPath = []) {
            if (obj && typeof obj === 'object') {
                let allKeys = Object.keys(obj)
                for (let i = 0; i < allKeys.length; i++) {
                    let k = allKeys[i]
                    let value = obj[k]

                    if (typeof value === 'object') {
                        // Look up the current keyPath in the namePath of metrics and extract the Schema_UUID
                        let path = (keyPath.join('/') + '/' + k + '/$meta').replace(/^\/|\/$/g, '')
                        let test = this.get(path, this.metrics, '/')

                        // If we have a $meta key at the location of this in our metrics that has a valid UUID then grab it
                        const uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/gi
                        if (test && 'Schema_UUID' in test && typeof test.Schema_UUID === 'string' && uuidRegex.test(test.Schema_UUID)) {

                            // Set the Schema_UUID property on the model at the correct place
                            this.set((keyPath.join('/') + '/' + k + '/Schema_UUID').replace(/^\/|\/$/g, ''), test.Schema_UUID, this.model, '/')

                            // Give the model an Instance_UUID if one doesn't already exist
                            if (!this.get((keyPath.join('/') + '/' + k + '/Instance_UUID').replace(/^\/|\/$/g, ''), this.model, '/')) {
                                this.set((keyPath.join('/') + '/' + k + '/Instance_UUID').replace(/^\/|\/$/g, ''), uuidv4(), this.model, '/')
                            }
                        }
                    }

                    // If we have more levels to nest then keep digging
                    if (typeof value === 'object') {
                        keyPath.push(k)
                        this.appendUUIDs(value, keyPath)
                        keyPath.pop()
                    }
                }
            }
            return obj
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

        set(path, toValue, onObject, delimiter = '.') {
            let schema = onObject  // a moving reference to internal objects within obj
            const pList = path.split(delimiter)
            const len = pList.length

            for (let i = 0; i < len - 1; i++) {
                const elem = pList[i]
                if (!schema[elem]) schema[elem] = {}
                schema = schema[elem]
            }
            this.$set(schema, pList[len - 1], toValue)
        },

        unset(path, onObject) {
            let schema = onObject  // a moving reference to internal objects within obj
            const pList = path.split('.')
            const len = pList.length

            for (let i = 0; i < len - 1; i++) {
                const elem = pList[i]
                if (!schema[elem]) schema[elem] = {}
                schema = schema[elem]
            }
            delete schema[pList[len - 1]]
        },

        selectSchema(schema, generateMetrics = true) {
            this.schemaBrowserVisible = false
            this.schema = schema.parsedSchema
            if (generateMetrics) {
                this.generateMetrics(schema.parsedSchema)
            }
            this.selectedSchemaId = schema.schemaObj.device_schema_id
            this.selectedSchemaVersionId = schema.schemaObj.device_schema_version_id
            this.loadingExistingConfig = false
        },

        save(activate) {
            if (this.loading) {
                return
            }
            this.loading = true

            this.prepareModelForSaving()

            axios.patch(`/api/devices/${this.device.id}/origin-map`, {
                'configuration': JSON.stringify(this.model),
                'metrics': JSON.stringify(this.metrics),
                'activate': activate,
                'device_schema_id': this.selectedSchemaId,
                'device_schema_version_id': this.selectedSchemaVersionId,
            }).then(() => {
                this.loading = false
                this.isDirty = false
                this.$emit('close')
                this.requestDataReloadFor('device')
                this.requestDataReloadFor('deviceConnections')
                this.selectedMetric = null
                window.showNotification({
                    title: 'Saved',
                    description: 'The configuration has been saved.',
                    type: 'success',
                })
            }).catch(error => {
                this.loading = false
                this.markDirty('Save failed')
                if (error && error.response && error.response.status === 401) {
                    this.goto_url('/login')
                }
                this.handleError(error, true)
            })

        },
    },

    data() {
        return {
            isDirty: false,
            loadingExistingConfig: true,
            refParser: $RefParser,
            loading: false,
            selectedMetric: null,
            rerenderTrigger: +new Date(),
            model: {},
            schemaBrowserVisible: false,
            schema: null,
            selectedSchemaId: null,
            selectedSchemaVersionId: null,
            showCDSImport: false,
            controls: [],
            metrics: {},
        }
    },
}
</script>


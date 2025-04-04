<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col">
    <!-- Tabs toggle at the top -->
    <div v-if="nestedPath.length === 0" class="mb-2">
      <Tabs
        v-model="tabValue"
        class="w-full"
        @update:modelValue="handleTabChange"
      >
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="all" class="text-xs">
            All
          </TabsTrigger>
          <TabsTrigger value="populated" class="text-xs">
            Populated
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <!-- For every key that isn't a reserved word -->
    <div v-for="key in filteredKeys">
      <!-- Metric node -->
      <SidebarMenuButton
        v-if="type(key) === 'metric'"
        :is-active="isMetricSelected(key)"
        :class="[
          'h-7 border-l -ml-2 rounded-none hover:bg-gray-100 rounded-r-full',
          isMetricSelected(key) ? 'border-l-2 border-gray-500 !bg-gray-200/70 font-medium' : ''
        ]"
        @click="$emit('selected', [{
          key: key,
          value: schema.properties[key],
          schemaUUID: schema.properties[key].allOf[0]?.properties?.Schema_UUID?.const,
        }])"
      >
        <div class="w-3 border-b -ml-2 -mr-1"></div>
        <div class="flex items-center gap-1 justify-between w-full">
            {{ key }}
          <div class="flex items-center gap-1">
          <i v-if="isMetricNotRecorded(key)" class="fa-solid fa-circle-exclamation text-red-500 text-xs" title="Not recorded to historian"></i>
          <i v-else-if="isMetricInModel(key)" class="fa-solid fa-circle-check text-green-500 text-xs" title="Added to model"></i>
          </div>
        </div>
      </SidebarMenuButton>

      <!-- Object or Schema Array node -->
      <SidebarMenuItem v-else-if="type(key) === 'object' || type(key) === 'schemaArray'">
        <Collapsible
          class="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
          :open="!isToggled(key)"
          @update:open="(open) => updateCollapsibleState(key, open)"
        >
          <CollapsibleTrigger class="flex w-full items-center py-1 text-sm h-7 gap-1 group">
            <ChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform duration-200"/>
            <span>{{ key }}</span>
            <div class="ml-auto flex items-center gap-1">
              <Button
                v-if="'patternProperties' in schema.properties[key]"
                variant="outline"
                size="plain"
                class="h-5 pl-1 pr-1.5 flex items-center justify-center gap-0.5 text-gray-500 border-gray-400 text-xs hover:!bg-gray-900 hover:!border-gray-900 hover:!text-white"
                @click.stop="newObject(key, schema)"
              >
                <i class="fa-solid fa-plus fa-fw" style="font-size: 10px"/>
                <div>New</div>
              </Button>
              <Button
                v-else-if="canBeDeleted()"
                variant="ghost"
                size="plain"
                class="size-5 items-center justify-center gap-0.5 text-gray-500 hover:text-red-300 hidden group-hover:flex"
                @click.stop="$emit('deleteObject', [{ key }])"
              >
                <i class="fa-sharp fa-solid fa-trash text-xs"/>
              </Button>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div class="ml-4">
              <!-- Empty state -->
              <div v-if="isEmptyNesting(schema, key)" class="text-sm text-gray-500 py-2">
                No items added
              </div>

              <!-- Nested items -->
              <SchemaGroup
                v-else-if="type(key) === 'object'"
                :key="getSchemaGroupKey(key)"
                @selected="e => $emit('selected', [...e, ...[{key: key, schemaUUID: schema.properties[key].properties?.Schema_UUID?.const}]])"
                @newObject="e => $emit('newObject', [...e, ...[{key: key}]])"
                @deleteObject="e => $emit('deleteObject', [...e, ...[{key: key}]])"
                @addToMetricArray="$emit('addToMetricArray')"
                @toggle-show-only-populated="$emit('toggle-show-only-populated', $event)"
                :selected-metric="selectedMetric"
                :schema="schema.properties[key]"
                :nested-path="[...nestedPath, ...[key]]"
                :model="model"
                :show-only-populated="showOnlyPopulated"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    </div>
  </div>
</template>

<script>
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { ChevronRight } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default {
  name: 'SchemaGroup',

  components: {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    SidebarMenuButton,
    SidebarMenuItem,
    ChevronRight,
    Button,
    Tabs,
    TabsList,
    TabsTrigger,
  },

  mounted () {
    // Load the toggle state from localStorage using the consistent key
    const storageKey = this.getToggleStateStorageKey();
    if (localStorage.getItem(storageKey)) {
      try {
        this.toggleState = JSON.parse(localStorage.getItem(storageKey));
      } catch (e) {
        localStorage.removeItem(storageKey);
      }
    } else {
      // Initialize all elements as collapsed by default
      this.initializeToggleState();
    }

    // Load the tab value from localStorage
    const savedTabValue = localStorage.getItem('schemaGroupTabValue');
    if (savedTabValue !== null) {
      this.tabValue = savedTabValue;
    }

    // Load the showOnlyPopulated preference from localStorage
    const savedShowOnlyPopulated = localStorage.getItem('showOnlyPopulated');
    if (savedShowOnlyPopulated !== null) {
      this.showOnlyPopulated = savedShowOnlyPopulated === 'true';
      // Ensure tab value is consistent with showOnlyPopulated
      this.tabValue = this.showOnlyPopulated ? 'populated' : 'all';
    }

    // Store the initial toggle state
    this.previousToggleState = JSON.parse(JSON.stringify(this.toggleState));

    // If we're in "Show Only Populated" mode, expand parent nodes with populated children
    if (this.showOnlyPopulated) {
      this.expandPopulatedParents();
    }
  },

  props: {
    nestedPath: {
      required: false,
      type: Array,
      default: () => [],
    },
    schema: {
      required: true,
      type: Object,
    },
    selectedMetric: {},
    model: {
      required: true,
      type: Object,
    },
    showOnlyPopulated: {
      type: Boolean,
      required: false,
    },
  },

  watch: {
    // Watch for changes to the model and update the toggle state if needed
    model: {
      deep: true,
      handler() {
        // If we're in "Show Only Populated" mode, expand parent nodes with populated children
        if (this.showOnlyPopulated) {
          this.expandPopulatedParents();
        }
      }
    }
  },

  methods: {

    isMetricSelected(key) {
      // If selectedMetric is not set, return false
      if (!this.selectedMetric) return false;

      // For metrics with a path property (which is how they're set in OriginMapEditor.vue)
      if (this.selectedMetric.path) {
        // Get the last segment of the path (the metric name)
        const lastPathSegment = this.selectedMetric.path[this.selectedMetric.path.length - 1];

        // Check if the current nested path matches the beginning of the selected metric's path
        // and if the key matches the last segment of the path
        if (this.nestedPath.length === this.selectedMetric.path.length - 1) {
          // Check if all segments of the nested path match the corresponding segments in the selected metric's path
          let pathMatches = true;
          for (let i = 0; i < this.nestedPath.length; i++) {
            if (this.nestedPath[i] !== this.selectedMetric.path[i]) {
              pathMatches = false;
              break;
            }
          }

          // If the paths match and the key matches the last segment, this is the selected metric
          return pathMatches && lastPathSegment === key;
        }
      }

      // Fallback to direct object comparison (though this is unlikely to work for dynamic objects)
      return this.selectedMetric === this.schema.properties[key];
    },

    isMetricInModel(key) {
      // Get the path to the metric in the model
      const path = [...this.nestedPath, key];

      // Navigate to the metric in the model
      let currentObj = this.model;
      for (const segment of path) {
        if (!currentObj || typeof currentObj !== 'object') return false;
        currentObj = currentObj[segment];
      }

      // Check if the metric exists in the model and is populated
      if (!currentObj || typeof currentObj !== 'object') return false;

      // For a metric to be considered "in the model", it MUST have at least one of:
      // - Value (with a non-empty value)
      // - Address (with a non-empty value)
      // - Path (with a non-empty value)
      // Just having Method is not enough
      return (('Value' in currentObj && currentObj.Value) ||
              ('Address' in currentObj && currentObj.Address) ||
              ('Path' in currentObj && currentObj.Path));
    },

    isMetricNotRecorded(key) {
      // Get the path to the metric in the model
      const path = [...this.nestedPath, key];

      // Navigate to the metric in the model
      let currentObj = this.model;
      for (const segment of path) {
        if (!currentObj || typeof currentObj !== 'object') return false;
        currentObj = currentObj[segment];
      }

      // Check if the metric exists and Record_To_Historian is false
      return currentObj &&
             typeof currentObj === 'object' &&
             'Record_To_Historian' in currentObj &&
             currentObj.Record_To_Historian === false;
    },

    hasPopulatedChildren(key) {
      // Get the path to the object in the model
      const path = [...this.nestedPath, key];

      // Navigate to the object in the model
      let currentObj = this.model;
      for (const segment of path) {
        if (!currentObj || typeof currentObj !== 'object') return false;
        currentObj = currentObj[segment];
      }

      // If the object doesn't exist in the model, it has no populated children
      if (!currentObj || typeof currentObj !== 'object') return false;

      // Helper function to check if a metric is populated
      const isMetricPopulated = (metric) => {
        if (!metric || typeof metric !== 'object') return false;

        // For a metric to be considered "populated", it MUST have at least one of:
        // - Value (with a non-empty value)
        // - Address (with a non-empty value)
        // - Path (with a non-empty value)
        // Just having Method is not enough
        return (('Value' in metric && metric.Value) ||
                ('Address' in metric && metric.Address) ||
                ('Path' in metric && metric.Path));
      };

      // Helper function to recursively check if an object has populated metrics
      const hasPopulatedMetrics = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object') return false;
        if (depth > 10) return false; // Prevent infinite recursion

        // Check if this object is a populated metric
        if (isMetricPopulated(obj)) return true;

        // Get the keys in their original order
        const keys = Object.keys(obj);

        // Check if any of its children are populated metrics
        return keys.some(childKey => {
          // Skip UUID properties and schema properties
          if (childKey === 'Schema_UUID' || childKey === 'Instance_UUID' ||
              childKey === 'patternProperties' || childKey === '$meta' ||
              childKey === 'required') {
            return false;
          }

          const child = obj[childKey];
          if (child && typeof child === 'object') {
            // Check if this child is a populated metric
            if (isMetricPopulated(child)) return true;

            // Recursively check this child's children
            return hasPopulatedMetrics(child, depth + 1);
          }

          return false;
        });
      };

      // Check if this is a schema array with pattern properties
      if (this.type(key) === 'schemaArray' && 'patternProperties' in this.schema.properties[key]) {
        // If it has any keys other than Schema_UUID and Instance_UUID, check if they have populated metrics
        // Get the keys in their original order
        const keys = Object.keys(currentObj);
        const dynamicKeys = keys.filter(k => k !== 'Schema_UUID' && k !== 'Instance_UUID');

        // If there are no dynamic keys, it has no populated children
        if (dynamicKeys.length === 0) return false;

        // Check if any of the dynamic keys have populated metrics
        return dynamicKeys.some(dynamicKey => {
          const dynamicObj = currentObj[dynamicKey];
          return hasPopulatedMetrics(dynamicObj);
        });
      }

      // For regular objects, check if any of its properties are in the model
      if (this.type(key) === 'object' && 'properties' in this.schema.properties[key]) {
        // Check if the object itself has any populated metrics
        if (hasPopulatedMetrics(currentObj)) return true;

        // Check if any of its properties have populated metrics
        // Get the properties in the order they appear in the schema
        const properties = Object.keys(this.schema.properties[key].properties).filter(e =>
          !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(e)
        );

        return properties.some(prop => {
          // Get the property from the model
          if (!currentObj[prop]) return false;

          // Check if this property has populated metrics
          return hasPopulatedMetrics(currentObj[prop]);
        });
      }

      // Default to NOT showing the object if we can't determine its contents
      return false;
    },

    getPropertyType(parentKey, propertyKey) {
      const property = this.schema.properties[parentKey]?.properties?.[propertyKey];
      if (!property) return 'unknown';

      if ('properties' in property) {
        return 'object';
      }

      if ('allOf' in property) {
        return 'metric';
      }

      if ('patternProperties' in property) {
        return 'schemaArray';
      }

      return 'unknown';
    },

    isPropertyInModel(parentPath, propertyKey) {
      // Get the full path to the property
      const path = [...parentPath, propertyKey];

      // Navigate to the property in the model
      let currentObj = this.model;
      for (const segment of path) {
        if (!currentObj || typeof currentObj !== 'object') return false;
        currentObj = currentObj[segment];
      }

      // Check if the property exists in the model
      if (currentObj === undefined || currentObj === null) return false;

      // Helper function to check if a metric is populated
      const isMetricPopulated = (metric) => {
        if (!metric || typeof metric !== 'object') return false;

        // For a metric to be considered "populated", it MUST have at least one of:
        // - Value (with a non-empty value)
        // - Address (with a non-empty value)
        // - Path (with a non-empty value)
        // Just having Method is not enough
        return (('Value' in metric && metric.Value) ||
                ('Address' in metric && metric.Address) ||
                ('Path' in metric && metric.Path));
      };

      // Helper function to recursively check if an object has populated metrics
      const hasPopulatedMetrics = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object') return false;
        if (depth > 5) return false; // Prevent infinite recursion

        // Check if this object is a populated metric
        if (isMetricPopulated(obj)) return true;

        // Get the keys in their original order
        const keys = Object.keys(obj);

        // Check if any of its children are populated metrics
        return keys.some(childKey => {
          // Skip UUID properties and schema properties
          if (childKey === 'Schema_UUID' || childKey === 'Instance_UUID' ||
              childKey === 'patternProperties' || childKey === '$meta' ||
              childKey === 'required') {
            return false;
          }

          const child = obj[childKey];
          if (child && typeof child === 'object') {
            // Check if this child is a populated metric
            if (isMetricPopulated(child)) return true;

            // Recursively check this child's children
            return hasPopulatedMetrics(child, depth + 1);
          }

          return false;
        });
      };

      // Check if the property has populated metrics
      return hasPopulatedMetrics(currentObj);
    },

    updateCollapsibleState(key, isOpen) {
      // Use the updateToggleState method to update the toggle state
      // This avoids duplicating code and ensures consistent behavior
      this.updateToggleState(key, isOpen);
    },

    handleTabChange(value) {
      // Save the current toggle state before changing the filter
      if (!this.previousToggleState) {
        this.previousToggleState = JSON.parse(JSON.stringify(this.toggleState));
      }

      // Update the tab value
      this.tabValue = value;

      // Save the tab preference in localStorage
      localStorage.setItem('schemaGroupTabValue', this.tabValue);

      // Update the showOnlyPopulated flag based on the selected tab
      this.showOnlyPopulated = (value === 'populated');

      // Save the preference in localStorage
      localStorage.setItem('showOnlyPopulated', this.showOnlyPopulated.toString());

      // Emit an event to notify parent components
      this.$emit('toggle-show-only-populated', this.showOnlyPopulated);

      if (this.showOnlyPopulated) {
        // When switching to "Show Only Populated", expand parent nodes with populated children
        this.expandPopulatedParents();
      } else {
        // When switching back to "Show All", restore the previous toggle state
        if (this.previousToggleState) {
          this.toggleState = JSON.parse(JSON.stringify(this.previousToggleState));
          this.saveToggleState();
        }
      }

      // Force a re-render of the component
      this.$forceUpdate();
    },

    toggleShowOnlyPopulated() {
      // For backward compatibility, toggle the tab value
      const newValue = this.showOnlyPopulated ? 'all' : 'populated';
      this.handleTabChange(newValue);
    },

    expandPopulatedParents() {
      // Get all keys that aren't reserved words
      const allKeys = Object.keys(this.schema.properties).filter(e =>
        !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(e)
      );

      // Find parent nodes with populated children
      allKeys.forEach(key => {
        if (this.type(key) === 'object' || this.type(key) === 'schemaArray') {
          // Check if this parent has populated children
          if (this.hasPopulatedChildren(key)) {
            // Expand this parent node
            const path = this.getTogglePath(key);

            // Find the index of this path in toggleState
            const index = this.toggleState.findIndex(item => {
              const [itemPath] = item.split(':state=');
              return itemPath === path;
            });

            if (index !== -1) {
              // Update the existing entry to open
              this.toggleState[index] = `${path}:state=open`;
            } else {
              // Add a new entry with open state
              this.toggleState.push(`${path}:state=open`);
            }

            // Also expand parent nodes in the path
            if (this.nestedPath.length > 0) {
              // Create a path for each level of nesting
              let parentPath = [];
              for (const segment of this.nestedPath) {
                parentPath.push(segment);
                const parentKey = this.getTogglePath(parentPath.join('.'));

                // Find the index of this parent path in toggleState
                const parentIndex = this.toggleState.findIndex(item => {
                  const [itemPath] = item.split(':state=');
                  return itemPath === parentKey;
                });

                if (parentIndex !== -1) {
                  // Update the existing entry to open
                  this.toggleState[parentIndex] = `${parentKey}:state=open`;
                } else {
                  // Add a new entry with open state
                  this.toggleState.push(`${parentKey}:state=open`);
                }
              }
            }
          } else {
            // If this parent doesn't have populated children, make sure it's closed
            const path = this.getTogglePath(key);

            // Find the index of this path in toggleState
            const index = this.toggleState.findIndex(item => {
              const [itemPath] = item.split(':state=');
              return itemPath === path;
            });

            if (index !== -1) {
              // Update the existing entry to closed
              this.toggleState[index] = `${path}:state=closed`;
            } else {
              // Add a new entry with closed state
              this.toggleState.push(`${path}:state=closed`);
            }
          }
        }
      });

      // Save the updated toggle state
      this.saveToggleState();
    },

    newObject (key, schema) {
      this.$emit('newObject', [
        {
          key: key,
          value: schema.properties[key],
        }])
      this.toggle(key, true)
    },

    isEmptyNesting (schema, key) {
      return Object.keys(schema.properties[key]).length === 2 && Object.keys(schema.properties[key]).includes('type') &&
          Object.keys(schema.properties[key]).includes('patternProperties')
    },

    canBeDeleted () {

      // The nestingPointer has the name of the new object on the end, so to see if it belongs to a patternProperties
      // we need to create a new array without the last element and then add a `properties` element before every
      // element so that we have a path to the object in the schema.
      let n = this.nestedPath.slice(0, -1).flatMap(e => ['properties', e])

      // Work out what the object looks like for this model in the schema
      let nestedProperty = n.reduce((object, key) => object?.[key], this.schema)

      // If the nestedProperty has a patternProperties then we are a dynamic object and can be deleted
      if (nestedProperty?.patternProperties) {
        return true
      }
    },

    type (key) {

      if ('properties' in this.schema.properties[key]) {
        return 'object'
      }

      if ('allOf' in this.schema.properties[key]) {
        return 'metric'
      }

      if ('patternProperties' in this.schema.properties[key]) {
        return 'schemaArray'
      }

      return 'unknown'
    },

    getTogglePath (obj) {
      // For dynamic elements, we need to include more information to uniquely identify them
      // Check if this is a dynamic element (has a UUID or other unique identifier)
      const isDynamic = this.isDynamicElement(obj);

      if (isDynamic) {
        // For dynamic elements, include the UUID or other unique identifier in the path
        const uniqueId = this.getDynamicElementId(obj);
        return `${this.nestedPath.length > 0 ? (this.nestedPath.join('.') + '.') : ''}${obj}:${uniqueId}`;
      } else {
        // For static elements, use the regular path
        return `${this.nestedPath.length > 0 ? (this.nestedPath.join('.') + '.') : ''}${obj}`;
      }
    },

    isDynamicElement(obj) {
      // Check if this is a dynamic element (created by the user)
      // Dynamic elements typically have a UUID or are under a patternProperties section

      // Check if the object's parent has patternProperties
      if (this.schema.properties && this.schema.properties[obj] && 'patternProperties' in this.schema.properties[obj]) {
        return true;
      }

      // Check if the object is in the schema's patternProperties
      if (this.schema.patternProperties && obj in this.schema.patternProperties) {
        return true;
      }

      // Check if the object matches a pattern in patternProperties
      if (this.schema.patternProperties) {
        for (const pattern in this.schema.patternProperties) {
          if (new RegExp(pattern).test(obj)) {
            return true;
          }
        }
      }

      // Check if we're in a nested path that might contain dynamic elements
      if (this.nestedPath.length > 0) {
        // Check if any part of the nested path is a dynamic element
        // This helps identify different instances of the same object type
        return true;
      }

      // Check if the object is in the model and has an Instance_UUID
      const path = [...this.nestedPath, obj];
      let currentObj = this.model;
      for (const segment of path) {
        if (!currentObj || typeof currentObj !== 'object') return false;
        currentObj = currentObj[segment];
      }

      return currentObj && typeof currentObj === 'object' && 'Instance_UUID' in currentObj;
    },

    getDynamicElementId(obj) {
      // Get a unique identifier for a dynamic element
      // This could be its UUID or a hash of its properties

      // Try to get the Instance_UUID from the model
      const path = [...this.nestedPath, obj];
      let currentObj = this.model;
      for (const segment of path) {
        if (!currentObj || typeof currentObj !== 'object') return 'unknown';
        currentObj = currentObj[segment];
      }

      if (currentObj && typeof currentObj === 'object' && 'Instance_UUID' in currentObj) {
        return currentObj.Instance_UUID;
      }

      // If we're in a nested path, include the full path in the ID
      // This ensures different instances of the same object type have different IDs
      if (this.nestedPath.length > 0) {
        // Include the nested path and the current object name in the ID
        const fullPath = [...this.nestedPath, obj].join('-');

        // If we have a parent Instance_UUID, include that too
        if (this.model && this.model.Instance_UUID) {
          return `${this.model.Instance_UUID}-${fullPath}`;
        }

        return `path-${fullPath}`;
      }

      // If no UUID is available, use a hash of the object's keys
      if (currentObj && typeof currentObj === 'object') {
        return Object.keys(currentObj).sort().join('-');
      }

      // Fallback to a timestamp-based ID
      return `dynamic-${Date.now()}`;
    },

    getSchemaGroupKey(key) {
      // Generate a unique key for the SchemaGroup component
      // This ensures that the component re-renders when the model changes
      if (this.isDynamicElement(key)) {
        return `${key}-${this.getDynamicElementId(key)}`;
      } else {
        return key;
      }
    },

    initializeToggleState() {
      // Initialize all elements as collapsed by default
      // This is called when no toggle state is found in localStorage
      this.toggleState = [];

      // Get all keys that aren't reserved words
      const allKeys = Object.keys(this.schema.properties).filter(e =>
        !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(e)
      );

      // Add all keys to toggleState with state=closed
      allKeys.forEach(key => {
        if (this.type(key) === 'object' || this.type(key) === 'schemaArray') {
          const path = this.getTogglePath(key);
          this.toggleState.push(`${path}:state=closed`);
        }
      });

      // Save the toggle state to localStorage
      this.saveToggleState();
    },

    toggle (obj, state = null) {
      const path = this.getTogglePath(obj);

      // Check if the path is already in toggleState
      const index = this.toggleState.findIndex(item => {
        const [itemPath] = item.split(':state=');
        return itemPath === path;
      });

      if (state === true) {
        // Open the collapsible
        const stateEntry = `${path}:state=open`;
        if (index !== -1) {
          this.toggleState[index] = stateEntry;
        } else {
          this.toggleState.push(stateEntry);
        }
      } else if (state === false) {
        // Close the collapsible
        const stateEntry = `${path}:state=closed`;
        if (index !== -1) {
          this.toggleState[index] = stateEntry;
        } else {
          this.toggleState.push(stateEntry);
        }
      } else {
        // Toggle the state
        if (index !== -1) {
          // Get the current state
          const [, currentState] = this.toggleState[index].split(':state=');
          // Toggle the state
          const newState = currentState === 'open' ? 'closed' : 'open';
          this.toggleState[index] = `${path}:state=${newState}`;
        } else {
          // Default to closed if not in toggleState
          this.toggleState.push(`${path}:state=closed`);
        }
      }
      this.saveToggleState();
    },

    saveToggleState () {
      const parsed = JSON.stringify(this.toggleState);
      // Use a consistent key for localStorage that includes the Instance_UUID
      const storageKey = this.getToggleStateStorageKey();
      localStorage.setItem(storageKey, parsed);
    },

    getToggleStateStorageKey() {
      // Create a consistent key for localStorage that includes the Instance_UUID
      // For the root SchemaGroup, use the model's Instance_UUID
      // For nested SchemaGroups, include the nested path
      if (this.model && this.model.Instance_UUID) {
        if (this.nestedPath.length > 0) {
          return `toggleState-${this.model.Instance_UUID}-${this.nestedPath.join('-')}`;
        } else {
          return `toggleState-${this.model.Instance_UUID}`;
        }
      } else {
        // Fallback if no Instance_UUID is available
        return `toggleState-unknown-${this.nestedPath.join('-')}`;
      }
    },

    isToggled (obj) {
      // If the path is in toggleState, it means the collapsible's state is explicitly set
      // If the path is not in toggleState, use the default state (defaultCollapsed)
      const path = this.getTogglePath(obj);

      // Check if this object is a parent of the selected metric
      // If so, always return false (expanded)
      if (this.selectedMetric && this.selectedMetric.path) {
        // Get the path of the selected metric
        const metricPath = this.selectedMetric.path;

        // Check if the current object is in the path of the selected metric
        // We need to account for the nested path of this SchemaGroup component
        const fullPath = [...this.nestedPath, obj];

        // Check if fullPath is a prefix of metricPath
        let isParentOfSelectedMetric = true;
        for (let i = 0; i < fullPath.length; i++) {
          if (i >= metricPath.length || fullPath[i] !== metricPath[i]) {
            isParentOfSelectedMetric = false;
            break;
          }
        }

        // If this object is a parent of the selected metric, always keep it expanded
        if (isParentOfSelectedMetric) {
          return false; // Not toggled (expanded)
        }
      }

      // Check if the path is in toggleState
      const index = this.toggleState.findIndex(item => {
        // Split the item into path and state
        const [itemPath, itemState] = item.split(':state=');
        return itemPath === path;
      });

      if (index !== -1) {
        // If the path is in toggleState, return the stored state
        const [, state] = this.toggleState[index].split(':state=');
        return state === 'closed';
      } else {
        // If the path is not in toggleState, use the default state
        return this.defaultCollapsed;
      }
    },

    updateToggleState(obj, isOpen) {
      // Helper method to update the toggle state
      const path = this.getTogglePath(obj);

      // Check if the path is already in toggleState
      const index = this.toggleState.findIndex(item => {
        const [itemPath] = item.split(':state=');
        return itemPath === path;
      });

      const state = isOpen ? 'open' : 'closed';
      const stateEntry = `${path}:state=${state}`;

      if (index !== -1) {
        // Update existing entry
        this.toggleState[index] = stateEntry;
      } else {
        // Add new entry
        this.toggleState.push(stateEntry);
      }

      // Save the toggle state
      this.saveToggleState();
    },

  },

  computed: {
    filteredKeys() {
      // Get all keys that aren't reserved words in the order they appear in the schema
      // We use Object.keys to get the keys in the order they were defined in the schema
      const allKeys = Object.keys(this.schema.properties).filter(e =>
        !['patternProperties', '$meta', 'Schema_UUID', 'Instance_UUID', 'required'].includes(e)
      );

      // If not filtering, return all keys in their original order
      if (!this.showOnlyPopulated) {
        return allKeys;
      }

      // Filter to only show keys that exist in the model, preserving the original order
      return allKeys.filter(key => {
        if (this.type(key) === 'object' || this.type(key) === 'schemaArray') {
          // For objects and schema arrays, check if they have any populated children
          return this.hasPopulatedChildren(key);
        } else if (this.type(key) === 'metric') {
          // Only show metrics that are in the model
          return this.isMetricInModel(key);
        }
        return true;
      });
    },
  },
  data () {
    return {
      toggleState: [],
      previousToggleState: null, // Store the previous toggle state when switching between modes
      showOnlyPopulated: false,
      tabValue: 'all', // Default tab value
      defaultCollapsed: true, // Default state for collapsibles (true = collapsed)
    }
  },
}
</script>

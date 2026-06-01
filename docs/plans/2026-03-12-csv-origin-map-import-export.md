# CSV Origin Map Import/Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Add Download CSV and Upload CSV buttons to the OriginMapEditor sidebar so that origin map metric values can be exported to and imported from CSV files.

**Architecture:** A `useOriginMapCsv.js` composable handles all CSV generation, parsing, and model application. The upload confirmation dialog and both buttons live inline in `OriginMapEditor.vue`, following the existing `newObjectContext` dialog pattern. PapaParse handles CSV serialisation.

**Tech Stack:** Vue 3, PapaParse, Reka UI Dialog, vue-sonner toasts

---

### Task 1: Install PapaParse dependency

**Files:**
- Modify: `acs-admin/package.json`

**Step 1: Install papaparse**

Run:
```bash
cd acs-admin && npm install papaparse
```

**Step 2: Verify installation**

Run:
```bash
cd acs-admin && node -e "require('papaparse'); console.log('ok')"
```
Expected: `ok`

**Step 3: Commit**

```bash
git add acs-admin/package.json acs-admin/package-lock.json
git commit -m "feat: add papaparse dependency for CSV origin map import/export"
```

---

### Task 2: Create the useOriginMapCsv composable — tree walker and CSV generation

**Files:**
- Create: `acs-admin/src/composables/useOriginMapCsv.js`

**Context:**

The schema tree has three node types determined by checking properties on each `schema.properties[key]`:
- `'allOf' in prop` → metric leaf
- `'properties' in prop` → object (recurse)
- `'patternProperties' in prop` → schema array (iterate model instances, recurse with pattern template as schema)

Reserved keys to skip: `Schema_UUID`, `Instance_UUID`, `patternProperties`, `$meta`, `required`.

After `updateDynamicSchemaObjects()` runs in OriginMapEditor (which happens on mount), schema array instances are injected into `schema.properties[instanceName]` as full schema objects. So the walker can treat them as regular objects.

Each metric leaf's schema is at `schema.properties[key].allOf[0].properties` merged with `schema.properties[key].allOf[1].properties`. The `Sparkplug_Type.enum` array gives allowed types.

Driver presentation is at `driverPresentation.address.title` (default: `'Device Address'`), `driverPresentation.path.title` (default: `'Metric Path'`), and `driverPresentation.path.hidden` (omit Path column when `true`).

**Step 1: Create the composable with `collectMetricRows` and `generateCsv`**

```javascript
import Papa from 'papaparse'

const RESERVED_KEYS = ['Schema_UUID', 'Instance_UUID', 'patternProperties', '$meta', 'required']

/**
 * Determine the type of a schema property node.
 * Mirrors SchemaGroup.vue's type() method.
 */
function nodeType (prop) {
  if ('properties' in prop) return 'object'
  if ('allOf' in prop) return 'metric'
  if ('patternProperties' in prop) return 'schemaArray'
  return 'unknown'
}

/**
 * Walk the schema/model tree and collect one row per metric leaf.
 * Returns an array of { tagPath, metricSchema, modelValues }.
 */
function collectMetricRows (schema, model, pathSegments = []) {
  const rows = []
  if (!schema?.properties) return rows

  const keys = Object.keys(schema.properties).filter(k => !RESERVED_KEYS.includes(k))

  for (const key of keys) {
    const prop = schema.properties[key]
    const currentPath = [...pathSegments, key]
    const type = nodeType(prop)

    if (type === 'metric') {
      // Merge allOf schemas to get full metric schema
      const metricSchema = { ...prop.allOf[0]?.properties, ...prop.allOf[1]?.properties }
      // Walk model to find current values
      const modelValues = currentPath.reduce((obj, seg) => obj?.[seg], model) || {}
      rows.push({ tagPath: currentPath.join('/'), metricSchema, modelValues })
    } else if (type === 'object') {
      rows.push(...collectMetricRows(prop, model, currentPath))
    } else if (type === 'schemaArray') {
      // Schema array instances exist in the model — iterate them
      // After updateDynamicSchemaObjects, instances are also in schema.properties
      const modelNode = currentPath.reduce((obj, seg) => obj?.[seg], model)
      if (modelNode && typeof modelNode === 'object') {
        const instanceKeys = Object.keys(modelNode).filter(k => !RESERVED_KEYS.includes(k))
        for (const instanceKey of instanceKeys) {
          // The instance schema was injected into schema.properties by updateDynamicSchemaObjects
          const instanceSchema = prop.properties?.[instanceKey]
          if (instanceSchema && nodeType(instanceSchema) === 'object') {
            rows.push(...collectMetricRows(instanceSchema, model, [...currentPath, instanceKey]))
          }
        }
      }
    }
  }

  return rows
}

/**
 * Build column headers based on driver presentation.
 */
function buildHeaders (driverPresentation) {
  const hidePathField = driverPresentation?.path?.hidden === true
  const addressLabel = driverPresentation?.address?.title || 'Device Address'
  const pathLabel = driverPresentation?.path?.title || 'Metric Path'

  const headers = ['Tag_Path', 'Sparkplug_Type', 'Allowed_Sparkplug_Types', addressLabel]
  if (!hidePathField) headers.push(pathLabel)
  headers.push('Value', 'Eng_Unit', 'Eng_Low', 'Eng_High', 'Deadband', 'Record_To_Historian')

  return { headers, hidePathField, addressLabel, pathLabel }
}

/**
 * Map a metric row to a CSV data row (array of values).
 */
function metricToRow (row, headerInfo) {
  const { hidePathField } = headerInfo
  const { tagPath, metricSchema, modelValues } = row

  const allowedTypes = metricSchema?.Sparkplug_Type?.enum?.filter(t => t !== '').join('|') || ''

  const values = [
    tagPath,
    modelValues.Sparkplug_Type ?? '',
    allowedTypes,
    modelValues.Address ?? '',
  ]
  if (!hidePathField) values.push(modelValues.Path ?? '')
  values.push(
    modelValues.Value ?? '',
    modelValues.Eng_Unit ?? '',
    modelValues.Eng_Low ?? '',
    modelValues.Eng_High ?? '',
    modelValues.Deadband ?? '',
    modelValues.Record_To_Historian ?? '',
  )

  return values
}

/**
 * Build help section rows that go below the --- delimiter.
 */
function buildHelpRows (headerInfo, driverPresentation) {
  const { headers, hidePathField } = headerInfo

  const pad = (text) => {
    const row = new Array(headers.length).fill('')
    row[0] = text
    return row
  }

  const rows = []
  // Delimiter row
  const delimiter = new Array(headers.length).fill('')
  delimiter[0] = '---'
  rows.push(delimiter)

  rows.push(pad(''))
  rows.push(pad('COLUMN DESCRIPTIONS'))
  rows.push(pad('Tag_Path: Metric location in the schema hierarchy. Used as the key when importing — do not modify.'))
  rows.push(pad('Sparkplug_Type: The Sparkplug B data type for this metric (e.g., Double, Float, Int32).'))
  rows.push(pad('Allowed_Sparkplug_Types: Valid types for this metric. Informational only — ignored on import.'))

  const addressDesc = driverPresentation?.address?.description || 'The device address for this metric.'
  rows.push(pad(`${headerInfo.addressLabel}: ${addressDesc}`))

  if (!hidePathField) {
    const pathDesc = driverPresentation?.path?.description || 'The metric path on the device.'
    rows.push(pad(`${headerInfo.pathLabel}: ${pathDesc}`))
  }

  rows.push(pad('Value: A static value for this metric (use instead of Address/Path for constants).'))
  rows.push(pad('Eng_Unit: Engineering unit (e.g., kWh, °C, RPM).'))
  rows.push(pad('Eng_Low: Lower bound of the engineering range.'))
  rows.push(pad('Eng_High: Upper bound of the engineering range.'))
  rows.push(pad('Deadband: Minimum change threshold before reporting a new value.'))
  rows.push(pad('Record_To_Historian: Whether to record this metric to the historian (true/false).'))
  rows.push(pad(''))
  rows.push(pad('Everything below the --- line is ignored on import.'))

  return rows
}

/**
 * Generate a CSV string from the origin map model and schema.
 *
 * @param {Object} model - The origin map model
 * @param {Object} schema - The hydrated schema (after updateDynamicSchemaObjects)
 * @param {Object} driverPresentation - The driver presentation config (driverInfo.presentation)
 * @returns {string} CSV string
 */
export function generateCsv (model, schema, driverPresentation) {
  const headerInfo = buildHeaders(driverPresentation)
  const metricRows = collectMetricRows(schema, model)

  const dataRows = metricRows.map(row => metricToRow(row, headerInfo))
  const helpRows = buildHelpRows(headerInfo, driverPresentation)

  const allRows = [headerInfo.headers, ...dataRows, ...helpRows]

  return Papa.unparse(allRows)
}

/**
 * Trigger a browser download of the CSV string.
 *
 * @param {string} csvString - The CSV content
 * @param {string} filename - The download filename
 */
export function downloadCsv (csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
```

**Step 2: Verify file was created correctly**

Run:
```bash
head -5 acs-admin/src/composables/useOriginMapCsv.js
```
Expected: First 5 lines of the file including the `import Papa` line.

**Step 3: Commit**

```bash
git add acs-admin/src/composables/useOriginMapCsv.js
git commit -m "feat: add CSV generation composable for origin map export"
```

---

### Task 3: Add CSV parsing and model application to the composable

**Files:**
- Modify: `acs-admin/src/composables/useOriginMapCsv.js`

**Context:**

Parsing must: (1) stop at `---` delimiter row, (2) reverse-map driver-specific column headers back to canonical field names, (3) return structured rows. Model application must: walk the model tree by tag path segments, overwrite found metrics, count skipped rows.

The canonical field names used in the model are: `Address`, `Path`, `Value`, `Sparkplug_Type`, `Eng_Unit`, `Eng_Low`, `Eng_High`, `Deadband`, `Record_To_Historian`. The CSV headers may differ for Address and Path (driver-specific labels).

**Step 1: Add `parseCsv` and `applyCsvToModel` functions**

Append to `acs-admin/src/composables/useOriginMapCsv.js`, before the closing (after the `downloadCsv` function):

```javascript
/**
 * Build a reverse mapping from driver-specific column headers to canonical field names.
 */
function buildHeaderMap (headers, driverPresentation) {
  const addressLabel = driverPresentation?.address?.title || 'Device Address'
  const pathLabel = driverPresentation?.path?.title || 'Metric Path'

  const map = {}
  for (const header of headers) {
    if (header === 'Tag_Path') map[header] = 'Tag_Path'
    else if (header === 'Sparkplug_Type') map[header] = 'Sparkplug_Type'
    else if (header === 'Allowed_Sparkplug_Types') map[header] = 'Allowed_Sparkplug_Types'
    else if (header === addressLabel) map[header] = 'Address'
    else if (header === pathLabel) map[header] = 'Path'
    else if (header === 'Value') map[header] = 'Value'
    else if (header === 'Eng_Unit') map[header] = 'Eng_Unit'
    else if (header === 'Eng_Low') map[header] = 'Eng_Low'
    else if (header === 'Eng_High') map[header] = 'Eng_High'
    else if (header === 'Deadband') map[header] = 'Deadband'
    else if (header === 'Record_To_Historian') map[header] = 'Record_To_Historian'
  }
  return map
}

/**
 * Parse a CSV string, stopping at the --- delimiter row.
 * Returns an array of { tagPath, fields } objects.
 *
 * @param {string} csvString - Raw CSV text
 * @param {Object} driverPresentation - Driver presentation config
 * @returns {{ rows: Array<{ tagPath: string, fields: Object }> }}
 */
export function parseCsv (csvString, driverPresentation) {
  const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true })

  if (!parsed.data || parsed.data.length === 0) {
    return { rows: [] }
  }

  const headerMap = buildHeaderMap(parsed.meta.fields, driverPresentation)

  const rows = []
  for (const rawRow of parsed.data) {
    // Check for --- delimiter — stop processing
    const firstValue = Object.values(rawRow)[0]
    if (firstValue && firstValue.toString().startsWith('---')) break

    const tagPath = rawRow['Tag_Path']
    if (!tagPath || tagPath.trim() === '') continue

    // Map CSV columns to canonical field names, skipping informational columns
    const fields = {}
    for (const [csvHeader, canonical] of Object.entries(headerMap)) {
      if (canonical === 'Tag_Path' || canonical === 'Allowed_Sparkplug_Types') continue
      const value = rawRow[csvHeader]
      if (value !== undefined) {
        fields[canonical] = value
      }
    }

    rows.push({ tagPath: tagPath.trim(), fields })
  }

  return { rows }
}

/**
 * Apply parsed CSV rows to the origin map model.
 * Modifies the model in place.
 *
 * @param {Array<{ tagPath: string, fields: Object }>} rows - Parsed CSV rows
 * @param {Object} model - The origin map model (mutated in place)
 * @returns {{ applied: number, skipped: number }}
 */
export function applyCsvToModel (rows, model) {
  let applied = 0
  let skipped = 0

  for (const { tagPath, fields } of rows) {
    const segments = tagPath.split('/')

    // Walk the model to find the metric's parent, then access the metric
    let current = model
    let found = true
    for (const segment of segments) {
      if (current && typeof current === 'object' && segment in current) {
        current = current[segment]
      } else {
        found = false
        break
      }
    }

    if (!found || !current || typeof current !== 'object') {
      skipped++
      continue
    }

    // Apply field values to the metric
    for (const [field, value] of Object.entries(fields)) {
      const trimmed = typeof value === 'string' ? value.trim() : value

      if (trimmed === '' || trimmed === null || trimmed === undefined) {
        // Empty value — clear the field
        delete current[field]
      } else if (field === 'Record_To_Historian') {
        // Boolean field
        current[field] = trimmed.toLowerCase() === 'true'
      } else if (field === 'Eng_Low' || field === 'Eng_High' || field === 'Deadband') {
        // Numeric fields — store as number if valid
        const num = Number(trimmed)
        current[field] = isNaN(num) ? trimmed : num
      } else {
        current[field] = trimmed
      }
    }

    applied++
  }

  return { applied, skipped }
}
```

**Step 2: Commit**

```bash
git add acs-admin/src/composables/useOriginMapCsv.js
git commit -m "feat: add CSV parsing and model application to origin map composable"
```

---

### Task 4: Add Download CSV and Upload CSV buttons to OriginMapEditor sidebar

**Files:**
- Modify: `acs-admin/src/components/EdgeManager/Devices/OriginMapEditor/OriginMapEditor.vue`

**Context:**

The Save Changes button is at lines 47-56 inside the `<SidebarContent>`. The new buttons go immediately after it, before `</SidebarContent>` (line 57). Use `variant="outline"` for secondary appearance. The Download button calls `handleDownloadCsv()`. The Upload button opens a hidden file input.

Driver presentation is available via `this.conn` (useConnectionStore) — the connection UUID is at `this.device.deviceInformation?.connection`. Look up the connection from `this.conn.data`, then access `configuration.driver.presentation`.

**Step 1: Add imports**

At the top of the `<script>` section (after line 121, the Dialog import), add:

```javascript
import { DialogFooter } from '@/components/ui/dialog'
import { generateCsv, downloadCsv, parseCsv, applyCsvToModel } from '@/composables/useOriginMapCsv.js'
import { Upload, Download, TriangleAlert } from 'lucide-vue-next'
```

**Step 2: Register new components**

In the `components` object (around line 151), add:

```javascript
DialogFooter,
Upload,
Download,
TriangleAlert,
```

**Step 3: Add reactive data properties**

In the `data()` function (around line 999), add these properties:

```javascript
csvDialogOpen: false,
csvParsedData: null,
```

**Step 4: Add the Download and Upload buttons to the template**

After the Save Changes button closing `</Button>` tag (line 56), add:

```html
          <div class="flex gap-2 mx-3 mb-3">
            <Button variant="outline" class="flex-1" @click="handleDownloadCsv" :disabled="!schema">
              <Download class="size-4 mr-1" />
              Download CSV
            </Button>
            <Button variant="outline" class="flex-1" @click="$refs.csvFileInput.click()" :disabled="!schema">
              <Upload class="size-4 mr-1" />
              Upload CSV
            </Button>
          </div>
          <input
            ref="csvFileInput"
            type="file"
            accept=".csv"
            class="hidden"
            @change="handleCsvFileSelected"
          />
```

**Step 5: Add the upload confirmation dialog to the template**

After the existing `</Dialog>` tag for `newObjectContext` (line 24), add:

```html
      <Dialog :open="csvDialogOpen" @update:open="(open) => { if (!open) { csvDialogOpen = false; csvParsedData = null } }">
        <DialogContent class="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <TriangleAlert class="size-5 text-amber-500" />
              Import CSV
            </DialogTitle>
            <DialogDescription>
              This will overwrite all current metric values in the origin map with values from the CSV file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="flex gap-2 sm:justify-start">
            <Button variant="destructive" @click="handleCsvSave">
              Save
            </Button>
            <Button variant="outline" @click="handleCsvReview">
              Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

**Step 6: Add the methods**

In the `methods` section (alongside `save()`, around line 933), add:

```javascript
    getDriverPresentation () {
      const connectionUuid = this.device.deviceInformation?.connection
      if (!connectionUuid) return null
      const connectionInfo = this.conn.data.find(c => c.uuid === connectionUuid)
      return connectionInfo?.configuration?.driver?.presentation || null
    },

    handleDownloadCsv () {
      const driverPresentation = this.getDriverPresentation()
      const csvString = generateCsv(this.model, this.schema, driverPresentation)
      const deviceName = this.device.name || this.device.uuid || 'device'
      const safeName = deviceName.replace(/[^a-zA-Z0-9_-]/g, '_')
      downloadCsv(csvString, `${safeName}_origin_map.csv`)
    },

    handleCsvFileSelected (event) {
      const file = event.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (e) => {
        const csvString = e.target.result
        const driverPresentation = this.getDriverPresentation()
        const { rows } = parseCsv(csvString, driverPresentation)

        if (rows.length === 0) {
          toast.error('No data rows found in CSV')
          this.$refs.csvFileInput.value = ''
          return
        }

        this.csvParsedData = rows
        this.csvDialogOpen = true
      }
      reader.readAsText(file)

      // Reset input so the same file can be re-selected
      this.$refs.csvFileInput.value = ''
    },

    applyParsedCsv () {
      if (!this.csvParsedData) return { applied: 0, skipped: 0 }
      const result = applyCsvToModel(this.csvParsedData, this.model)

      if (result.skipped > 0) {
        toast.warning(`${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped`, {
          description: 'Paths not found in schema.',
        })
      }

      this.markDirty()
      this.groupRerenderTrigger = +new Date()
      this.rerenderTrigger = +new Date()

      // Clear selected metric since model has changed
      this.selectedMetric = null

      return result
    },

    async handleCsvSave () {
      this.applyParsedCsv()
      this.csvDialogOpen = false
      this.csvParsedData = null
      await this.save()
    },

    handleCsvReview () {
      this.applyParsedCsv()
      this.csvDialogOpen = false
      this.csvParsedData = null
      toast.info('CSV imported', {
        description: 'Review changes and save manually.',
      })
    },
```

**Step 7: Commit**

```bash
git add acs-admin/src/components/EdgeManager/Devices/OriginMapEditor/OriginMapEditor.vue
git commit -m "feat: add Download CSV and Upload CSV buttons to OriginMapEditor"
```

---

### Task 5: Manual testing and edge case verification

**Files:**
- No changes — verification only

**Step 1: Start the dev server**

Run:
```bash
cd acs-admin && npm run dev
```

**Step 2: Test Download CSV**

1. Navigate to an existing device with a populated origin map
2. Click "Download CSV"
3. Verify:
   - CSV downloads with correct filename (`{device}_origin_map.csv`)
   - Tag_Path column has `/`-separated paths
   - Sparkplug_Type and Allowed_Sparkplug_Types are populated
   - Address/Path columns use driver-specific labels
   - Path column is omitted when driver has `path.hidden === true`
   - Existing metric values are populated
   - Help section appears below `---` delimiter

**Step 3: Test Upload CSV — Save path**

1. Modify the downloaded CSV (change some Address values, clear some fields)
2. Click "Upload CSV", select the modified file
3. Verify confirmation dialog appears with warning text
4. Click "Save"
5. Verify: toast shows "Origin map saved", values are updated, changes persisted

**Step 4: Test Upload CSV — Review path**

1. Click "Upload CSV", select a CSV file
2. Click "Review"
3. Verify: dialog closes, toast shows "CSV imported. Review changes and save manually."
4. Browse metric tree — verify values match CSV
5. Click "Save Changes" to persist

**Step 5: Test edge cases**

1. Upload a CSV with non-existent tag paths → verify toast shows skipped count
2. Upload an empty CSV (just headers) → verify "No data rows found" toast
3. Upload a CSV with empty value columns → verify fields are cleared
4. Download CSV for a device with schema arrays → verify only existing instances appear
5. Verify commas in engineering unit values (e.g., "kg/m²,s") are handled correctly

**Step 6: Commit any fixes**

If any issues were found and fixed during testing, commit them:

```bash
git add -u
git commit -m "fix: address edge cases in CSV origin map import/export"
```

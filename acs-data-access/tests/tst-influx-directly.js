import {InfluxDB, flux} from '@influxdata/influxdb-client';
import { count } from 'rxjs';

const url = process.env.INFLUXDB_URL;
const token = process.env.INFLUXDB_TOKEN;
const org = process.env.INFLUXDB_ORG;
const bucket = process.env.INFLUXDB_BUCKET;

const influxDB = new InfluxDB({ url, token });
const queryApi = influxDB.getQueryApi(org);

/**
 * Get all data for a specific topLevelInstance tag.
 */
async function getAllDataForTag(topLevelInstance) {
  const flux = `
    from(bucket: "${bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r["topLevelInstance"] == "${topLevelInstance}")
  `;

  const rows = [];

  return new Promise((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        rows.push(tableMeta.toObject(row));
      },
      error(error) {
        reject(error);
      },
      complete() {
        resolve(rows);
      }
    });
  });
}

/**
 * Get first and last timestamps for a specific topLevelInstance tag.
 */
async function getTimestampRange(topLevelInstance) {
  const firstQuery = `
    from(bucket: "${bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r["topLevelInstance"] == "${topLevelInstance}")
      |> sort(columns: ["_time"])
      |> limit(n: 1)
  `;

  const lastQuery = `
    from(bucket: "${bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r["topLevelInstance"] == "${topLevelInstance}")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 1)
  `;

  async function runSingleRowQuery(flux) {
    return new Promise((resolve, reject) => {
      let result = null;

      queryApi.queryRows(flux, {
        next(row, tableMeta) {
          result = tableMeta.toObject(row);
        },
        error(error) {
          reject(error);
        },
        complete() {
          resolve(result);
        }
      });
    });
  }

  const [first, last] = await Promise.all([
    runSingleRowQuery(firstQuery),
    runSingleRowQuery(lastQuery)
  ]);

  return {
    firstTimestamp: first?._time || null,
    lastTimestamp: last?._time || null
  };
}


async function countRowsForTag(topLevelInstance) {
  const flux = `
    from(bucket: "${bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r["topLevelInstance"] == "${topLevelInstance}")
      |> group()
      |> count(column: "_value")
      |> sum(column: "_value")
  `;

  return new Promise((resolve, reject) => {
    let total = 0;

    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        total = obj._value || 0;
      },
      error: reject,
      complete: () => resolve(total),
    });
  });
}


async function getAllTagsAndFieldsForTag(topLevelInstance) {
  const flux = `
    from(bucket: "${bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r["topLevelInstance"] == "${topLevelInstance}")
      |> limit(n: 1000)
  `;

  return new Promise((resolve, reject) => {
    const tags = new Set();
    const fields = new Set();

    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);

        // Fields
        if (obj._field) {
          fields.add(obj._field);
        }

        // Tags = all string keys except reserved Influx columns
        for (const key of Object.keys(obj)) {
          if (
            !["_time", "_value", "_field", "_measurement"].includes(key)
          ) {
            tags.add(key);
          }
        }
      },
      error(err) {
        reject(err);
      },
      complete() {
        resolve({
          tags: [...tags],
          fields: [...fields],
        });
      },
    });
  });
}

/**
 * Example usage
 */

const SESSION_DATASETS = {
  "TestSessionAllDataset": "74cac8a1-88a6-4b08-b297-a3c05a388ec5"
}

const UNION_DATASETS = {
  "TestUnionAllDataset": "e2a4c530-dc0f-417d-b00b-329b0e90e033"
}

const SRC_DATASETS = {
  "TestDeviceDataset": "492194aa-4ced-44d1-96c1-4e09e4d52f45",
  "TestDoubleDeviceDataset": "3af79d1f-bdc2-41a8-bf2b-bd16af8a92a2", 
  "TestFloatDeviceDataset": "3dc230e9-ab36-4729-8d93-6d5c421f7d7f",
  
  "Node2_TestDoubleDeviceDataset": "720ecd5a-c5d2-49d5-bf5a-8ca01dfdb7df",

  "Node2_TestFloutDeviceDataset": "9975fb51-ed1c-4bc9-a845-331c801f140f",
}

// NODE 1
const DEVICES_MAP = { 
  "TestDevice": "5880686f-13f9-4089-b236-825d002bc911",
  "TestDoubleDevice": "1298e74a-37d3-4717-aba1-4c1e67b953c1",
  "TestFloatDevice": "34b6910c-85ec-445b-9071-0813891e6ff7",
  
  "Node2_TestDoubleDevice": "d60d00bf-eae7-4f88-9ad2-cfc4c638ac7b",
  "Node2_TestFloutDevice": "961cb1c0-3d00-44e8-90bc-3fdf917746fc"
}

async function main() {
    // device uuid
  const topLevelInstance = DEVICES_MAP.TestDoubleDevice;

  console.log(`Fetching data for ${topLevelInstance}...`);

  // const data = await getAllDataForTag(topLevelInstance);

  // console.log(`Found ${data.length} rows`);

  // Show first few rows
  // console.dir(data.slice(0, 5), { depth: null });

  const rows_count = await countRowsForTag(topLevelInstance);
  console.log("Rows count:", rows_count);

  const time_range = await getTimestampRange(topLevelInstance);
  console.log('Timestamp range:', time_range);

  const fields = await getAllTagsAndFieldsForTag(topLevelInstance);
  console.log("Fields:", fields);
}

main().catch(console.error);
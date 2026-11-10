/*
 * ACS Data Access Service
 * Test support: the whole-map dataset algorithms, kept as oracles
 * Copyright 2026 University of Sheffield
 */

/* Not a test file itself: vitest only collects *.test.js.
 *
 * Each function below is a verbatim copy of code from lib/dataflow.js
 * as it stood before the per-change index, wrapped in a function and
 * otherwise unchanged (it keeps that file's layout). They rebuild
 * everything from the whole input on every call. Tests compare the
 * per-change code with them, so do not edit or tidy them: a difference
 * from the original would make the comparison worthless. */

import { List as IList, Map as IMap } from "immutable";

import { DataAccess as Constants } from "../../lib/constants.js";
import { minDate, maxDate } from "../../lib/utils.js";
import { default_dataset_device } from "../../lib/default-datasets.js";

/** The grouping loop of _build_apps_configs.
 * @arg appEntries An array of [app UUID, Map object -> config], in the
 * order the class member Set gives the applications.
 * @returns IMap object -> IMap app -> config.
 */
export function reference_group(appEntries) {
  let result = IMap();

  for (const [appId, config]
    of appEntries) {

    for (const [datasetId, payload]
      of config) {

      const existing =
        result.get(
          datasetId,
          IMap()
        );

      result = result.set(
        datasetId,
        existing.set(
          appId,
          payload
        )
      );
    }
  }

  return result;
}

/** The functional type inversion of _build_functional_types.
 * @arg data IMap group -> Set of members.
 * @returns IMap member -> IList of groups.
 */
export function reference_functional_types(data) {
  let result = IMap();

  data.forEach((memberIds, groupId) => {
    memberIds.forEach(memberId => {
      result = result.update(
        memberId,
        list =>
          list
            ? list.push(groupId)
            : IList([groupId])
      );
    });
  });

  return result;
}

/** The parts formula of _build_parts.
 * @arg subclassesMap IMap dataset -> Set of its subclasses.
 * @arg datasetMembers The Set of Dataset class members.
 * @returns IMap dataset -> Set of the subclasses that are datasets.
 */
export function reference_parts(subclassesMap, datasetMembers) {
  return (
  subclassesMap.map(
    subclass_uuids =>
      subclass_uuids.filter(
        x => datasetMembers.has(x)
      )
  )
  );
}

/** The default device map of _build_default_devices.
 * @arg datasets The dataset map.
 * @returns A native Map dataset UUID -> device UUID.
 */
export function reference_default_devices(datasets) {
  const devices = new Map();
  for (const [uuid, dataset] of datasets) {
    const device = default_dataset_device(uuid, dataset);
    if (device) devices.set(uuid, device);
  }
  return devices;
}

/** The filter of _build_valid_datasets. */
export function reference_valid(map) {
  return map.filter(
    def => def.structure !== Constants.Special.InvalidDataset
  );
}

/** The filter of _build_invalid_datasets. */
export function reference_invalid(map) {
  return map.filter(
    def => def.structure === Constants.Special.InvalidDataset
  );
}

/** The resolve-all map function of _build_datasets.
 * @arg groupedConfigs IMap object -> IMap structure app -> config.
 * @returns The dataset map: IMap object -> { structure, config, from, to }.
 */
export function reference_datasets(groupedConfigs) {

  /*
  * ------------------------------------------------------------
  * 1. Normalise duplicate definitions
  * ------------------------------------------------------------
  *
  * Convert:
  *
  * datasetId => IMap({
  *   appId => payload
  * })
  *
  * into:
  *
  * datasetId => {
  *   structure,
  *   config
  * }
  *
  * Invalid datasets are represented directly by:
  *
  * structure === Constants.Special.InvalidDataset
  */

  let map = groupedConfigs.map(
    (definitions) => {

      const entries =
        definitions
          .entrySeq()
          .toArray();

      /*
      * Multiple structural definitions
      * => invalid dataset
      */

      if (entries.length !== 1) {
        return {
          structure:
            Constants.Special.InvalidDataset,

          config: null,
          from: null,
          to: null
        };
      }

      const [structure, config] =
        entries[0];

      return {
        structure,
        config
      };
    }
  );

  /*
  * ------------------------------------------------------------
  * 2. Recursive resolution
  * ------------------------------------------------------------
  *
  * resolve(datasetId)
  *
  * Returns:
  *
  *   { from, to }
  *
  * or:
  *
  *   null
  *
  * where null means invalid.
  */

  const cache = new Map();

  const resolve =
    (datasetId, visited = new Set()) => {

    /*
    * Cached result
    */

    if (cache.has(datasetId))
      return cache.get(datasetId);

    /*
    * Cycle detection
    */

    if (visited.has(datasetId)) {
      cache.set(datasetId, null);
      return null;
    }

    visited.add(datasetId);

    const def =
      map.get(datasetId);

    /*
    * Missing dataset
    */

    if (!def) {
      cache.set(datasetId, null);
      return null;
    }

    /*
    * Already invalid
    */

    if (
      def.structure ===
      Constants.Special.InvalidDataset
    ) {
      cache.set(datasetId, null);
      return null;
    }

    const {
      structure,
      config
    } = def;

    /*
    * --------------------------------------------------
    * SESSION LIMITS
    * --------------------------------------------------
    */

    if (
      structure ===
      Constants.App.SessionLimits
    ) {

      const child =
        resolve(
          config.source,
          new Set(visited)
        );

      /*
      * Invalid child
      */

      if (!child) {
        cache.set(datasetId, null);
        return null;
      }

      const from =
        config.from
          ? new Date(config.from)
          : null;

      const to =
        config.to
          ? new Date(config.to)
          : null;

      const result = {
        from:
          maxDate(
            from,
            child.from
          ),

        to:
          minDate(
            to,
            child.to
          )
      };

      cache.set(datasetId, result);

      return result;
    }

    /*
    * --------------------------------------------------
    * SPARKPLUG SOURCE / SUB-DEVICE / UNS DEVICE (METRICS)
    * --------------------------------------------------
    */

    if (
      structure ===
      Constants.App.SparkplugSrc ||
      structure ===
      Constants.App.SparkplugSubset ||
      structure ===
      Constants.App.UNSDevice ||
      structure ===
      Constants.App.UNSDeviceMetrics
    ) {

      const result = {
        from: null,
        to: null
      };

      cache.set(datasetId, result);

      return result;
    }

    /*
    * --------------------------------------------------
    * UNION COMPONENTS
    * --------------------------------------------------
    */

    if (
      structure ===
      Constants.App.UnionComponents
    ) {

      const children =
        config.map(id =>
          resolve(
            id,
            new Set(visited)
          )
        );

      /*
      * Any invalid child
      */

      if (children.some(c => !c)) {
        cache.set(datasetId, null);
        return null;
      }

      const fromTimes =
        children
          .map(v =>
            v.from?.getTime()
          )
          .filter(t =>
            !isNaN(t)
          );

      const toTimes =
        children
          .map(v =>
            v.to?.getTime()
          )
          .filter(t =>
            !isNaN(t)
          );

      const result = {
        from:
          fromTimes.length
            ? new Date(
                Math.min(
                  ...fromTimes
                )
              )
            : null,

        to:
          toTimes.length
            ? new Date(
                Math.max(
                  ...toTimes
                )
              )
            : null
      };

      cache.set(datasetId, result);

      return result;
    }

    /*
    * --------------------------------------------------
    * Unknown structure
    * --------------------------------------------------
    */

    cache.set(datasetId, null);

    return null;
  };

  /*
  * ------------------------------------------------------------
  * 3. Resolve all datasets
  * ------------------------------------------------------------
  */

  return map.map(
    (def, datasetId) => {

      /*
      * Already invalid due to duplicate defs
      */

      if (
        def.structure ===
        Constants.Special.InvalidDataset
      ) {
        return def;
      }

      const resolved =
        resolve(datasetId);

      /*
      * Invalid dependency graph
      */

      if (!resolved) {
        return {
          structure:
            Constants.Special.InvalidDataset,

          config: null,
          from: null,
          to: null
        };
      }

      /*
      * Valid dataset
      */

      return {
        ...def,
        ...resolved
      };
    }
  );
}

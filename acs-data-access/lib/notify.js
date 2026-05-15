/*
* ACS Data Access Service
* DataAccessNotify
*/

import * as rx from "rxjs";
import { Map as IMap } from "immutable";

import * as rxu from "@amrc-factoryplus/rx-util";
import { Notify } from "@amrc-factoryplus/service-api";

import { DataAccess as Constants } from "./constants.js";
import { valid_uuid } from "./validate.js";
import { response } from "express";

export class DataAccessNotify {
  constructor(opts) {
    this.data = opts.data;
    this.auth = opts.auth;
    this.log = opts.debug.bound("notify");

    this.notify = this.build_notify(opts.api);
  }

  run() {
    this.log("Running Data Access Notify Server");
    this.notify.run();
  }

  build_notify(api) {
    const notify = new Notify({
      api,
      log: this.log,
    });

    notify.watch(
      "v2/metadata/",
      this.metadata_list.bind(this)
    );

    notify.watch(
      "v2/metadata/:uuid",
      this.metadata_uuid.bind(this)
    );

    notify.search(
      "v2/metadata/",
      this.metadata_search.bind(this)
    );

    notify.watch(
      "v2/structure/",
      this.structure_list.bind(this)
    );

    notify.watch(
      "v2/structure/:uuid",
      this.structure_uuid.bind(this)
    );

    notify.search(
      "v2/structure/",
      this.structure_search.bind(this)
    );

    return notify;
  }

  /*
  * =========================================================
  * METADATA
  * =========================================================
  */

  metadata_list(sess) {
    this.log(`Notify metadata list is hit: ${sess.principal}`);
    return this.data.allowed_valid_dataset_uuids(
      sess.principal,
      Constants.Perm.ReadDataset
    ).pipe(
      rx.map(data => ({
        status: 200,
        response: {body: data}
      }))
    );
  }

  metadata_uuid(sess, uuid) {
    if (!valid_uuid(uuid)) return;

    return rx.combineLatest([
      this.data.allowed_valid_datasets(
        sess.principal,
        Constants.Perm.ReadDataset
      ),

      this.data.general_infos,

      this.data.functional_types,

      this.data.metadata,

      this.data.allowed_dataset_parts(
        uuid,
        sess.principal,
        Constants.Perm.ReadDataset
      ),
    ]).pipe(
      rx.map(([
        datasets,
        infos,
        all_f_types,
        all_metadata,
        parts,
      ]) => {

        const dataset =
          datasets.get(uuid);

        /*
        * Dataset missing or invalid
        */

        if (!dataset)
          return null;

        const info =
          infos.get(uuid);

        return {
          uuid: uuid,

          name:
            info?.name ??
            "UNKNOWN",

          from:
            dataset.from ??
            undefined,

          to:
            dataset.to ??
            undefined,

          function:
            all_f_types.get(uuid),

          metadata:
            all_metadata.get(uuid),

          parts,
        };
      }),

      rx.distinctUntilChanged(
        (a, b) =>
          JSON.stringify(a) ===
          JSON.stringify(b)
      ),

      rxu.shareLatest(),
      rx.map(data => ({
        status: 200,
        response: {body: data}
      }))
    );
  }

  /*
  * Searchable metadata map
  */

  metadata_search(sess, filter) {
    return rx.combineLatest([
      this.data.allowed_valid_datasets(
        sess.principal,
        Constants.Perm.ReadDataset
      ),

      this.data.general_infos,
    ]).pipe(
      rx.map(([datasets, infos]) => {

        let result = IMap();

        datasets.forEach(
          (_, dataset_uuid) => {

            const info =
              infos.get(dataset_uuid);

            result = result.set(
              dataset_uuid,
              {
                uuid: dataset_uuid,
                name:
                  info?.name ??
                  "UNKNOWN",
              }
            );
          }
        );

        return result;
      }),

      rxu.shareLatest()
    );
  }

  /*
  * =========================================================
  * STRUCTURE
  * =========================================================
  */

  structure_list(sess) {
    return this.data.allowed_all_dataset_uuids(
      sess.principal,
      Constants.Perm.EditDataset
    ).pipe(
      rx.map(data => ({
        status: 200,
        response: {body: data}
      }))
    );
  }

  structure_uuid(sess, uuid) {
    if (!valid_uuid(uuid)) return; 

    return this.data.allowed_all_datasets(
      sess.principal,
      Constants.Perm.EditDataset
    ).pipe(
      rx.map(datasets =>
        datasets.get(uuid)
      ),

      rx.distinctUntilChanged(
        (a, b) =>
          JSON.stringify(a) ===
          JSON.stringify(b)
      ),

      rxu.shareLatest(),

      rx.map(data => ({
        status: 200,
        response: {body: data}
      }))
      
    );
  }

  structure_search(sess) {
    return this.data.allowed_all_datasets(
      sess.principal,
      Constants.Perm.EditDataset
    ).pipe(
      rx.map(datasets => {

        let result = IMap();

        datasets.forEach(
          (dataset, dataset_uuid) => {

            result = result.set(
              dataset_uuid,
              {
                uuid: dataset_uuid,
                structure:
                  dataset.structure,
              }
            );
          }
        );

        return result;
      }),

      rxu.shareLatest()
    );
  }
}
/*
* ACS Data Access Service
* DataAccessNotify
*/

import deep_equal from "deep-equal";
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
  // WATCH
  metadata_list(sess) {
    return this.data.allowed_valid_dataset_uuids(
      sess.principal,
      Constants.Perm.ReadDataset
    ).pipe(
      rx.map(data => ({
        status: 200,
        response: {
          body: data
        }
      }))
    );
  }

  _metadata_resource_state(sess, uuid) {
    if (!valid_uuid(uuid)) return;

    const datasets$ =
      this.data.allowed_valid_datasets(
        sess.principal,
        Constants.Perm.ReadDataset
      ).pipe(
        rx.startWith(IMap()) 
      );

    const infos$ =
      this.data.general_infos.pipe(
        rx.startWith(IMap())
      );

    const ftypes$ =
      this.data.functional_types.pipe(
        rx.startWith(IMap())
      );

    const metadata$ =
      this.data.metadata.pipe(
        rx.startWith(IMap())
      );

    const parts$ =
      this.data.allowed_dataset_parts(
        uuid,
        sess.principal,
        Constants.Perm.ReadDataset
      ).pipe(
        rx.startWith(IMap())   
      );

    return rx.combineLatest([
      datasets$,
      infos$,
      ftypes$,
      metadata$,
      parts$,
    ]).pipe(

      rx.map(([datasets, infos, ftypes, metadata, parts]) => {

        const dataset = datasets.get(uuid);

        if (!dataset) return; 

        const info = infos.get(uuid);

        return {
                uuid,
                name: info?.name ?? "UNKNOWN",
                from: dataset.from ?? undefined,
                to: dataset.to ?? undefined,
                function: ftypes?.get(uuid),
                metadata: metadata?.get(uuid),
                parts: parts ?? undefined,
              }
      }),

      rx.distinctUntilChanged(deep_equal),
      rxu.shareLatest()
    );
  }

  // WATCH
  metadata_uuid(sess, uuid) {
    return this._metadata_resource_state(sess, uuid)
    .pipe(
      rx.map(data => ({
        status: 200, 
        response: {
          body: data
        }
      }))
    );
  }

  /*
  * Searchable metadata map
  */



  _build_search_source(uuids) {
      const shared = uuids.pipe(
          rxu.shareLatest()
      );

      return {
          full: async () => {
              const state = await rx.firstValueFrom(
                  shared.pipe(
                      rx.take(1)
                  )
              );

              const children = Object.fromEntries(
                  state.entrySeq().map(([uuid, response]) => [
                      uuid,
                      {
                          status: response.status,
                          body: response.body,
                          ...(response.headers
                              ? { headers: response.headers }
                              : {}),
                      }
                  ])
              );

              return {
                  children,
                  response: { status: 204 },
              };
          },

          updates: shared.pipe(
              rx.startWith(IMap()),
              rx.pairwise(),

              rx.mergeMap(([prev, curr]) => {
                  const updates = [];

                  /**
                   * Created / Updated
                   */
                  curr.forEach((response, key) => {
                      const old = prev.get(key);

                      const plain = {
                          status: response.status,
                          body: response.body,
                          ...(response.headers
                              ? { headers: response.headers }
                              : {}),
                      };

                      /**
                       * Newly visible
                       */
                      if (!old) {
                          updates.push({
                              status: 200,
                              child: key,
                              response: {
                                  ...plain,
                                  status: plain.status === 200
                                      ? 201
                                      : plain.status,
                              },
                          });

                          return;
                      }

                      /**
                       * Changed
                       */
                      if (!deep_equal(old, response)) {
                          updates.push({
                              status: 200,
                              child: key,
                              response: plain,
                          });
                      }
                  });

                  /**
                   * Removed
                   */
                  prev.forEach((_, key) => {
                      if (!curr.has(key)) {
                          updates.push({
                              status: 200,
                              child: key,
                              response: {
                                  status: 404,
                              },
                          });
                      }
                  });

                  return rx.from(updates);
              })
          ),

          /**
           * Must be an operator function.
           */
          acl: rx.pipe(),
      };
  }

  metadata_search(sess) {
      const dataset_uuids = this.data
          .allowed_valid_dataset_uuids(
              sess.principal,
              Constants.Perm.ReadDataset
          )
          .pipe(
              rx.switchMap(uuids => {
                  const list = uuids.toArray?.() ?? [];

                  if (list.length === 0)
                      return rx.of(IMap());

                  return rx.combineLatest(
                      list.map(uuid =>
                          this._metadata_resource_state(sess, uuid).pipe(
                              rx.filter(x => x && typeof x === "object"),

                              /**
                               * Convert to plain serialisable object.
                               */
                              rx.map(res => [uuid, {
                                  status: 200,
                                  body: res
                              }])
                          )
                      )
                  ).pipe(
                      rx.map(entries => IMap(entries))
                  );
              }),

              rxu.shareLatest()
          );

      return this._build_search_source(dataset_uuids);
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
        response: {
          body: data
        }
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

      rx.distinctUntilChanged(deep_equal),

      rxu.shareLatest(),

      rx.map(dataset_def => {
        const {from, to, ...body} = dataset_def;
        return {
          status: 200,
          response: { body }
        }
      }),
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
/*
* ACS Data Access Service
* DataAccessNotify
*/

import { Notify } from "@amrc-factoryplus/service-api";

import { DataAccess as Constants } from "./constants.js";
import {
  DatasetView, member_body, metadata_body, search_source, structure_body,
  watch_key, watch_list,
} from "./dataset-view.js";
import { valid_uuid } from "./validate.js";
import { READ_STRUCTURE } from "./default-datasets.js";

/* Every handler below answers from a DatasetView of its own: the
 * datasets this one subscription shows, and a body for each. A change
 * to one dataset costs each open subscription the work for that
 * dataset. dataset-view.js has the rules. */

export class DataAccessNotify {
  constructor(opts) {
    this.data = opts.data;
    this.auth = opts.auth;
    this.log = opts.debug.bound("notify");

    /* The view of each open subscription. A view is here from when
     * its subscription starts until it ends. */
    this.views = new Set();

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

    notify.watch(
      "v2/union-sources/",
      this.union_sources_list.bind(this)
    );

    notify.watch(
      "v2/session-sources/",
      this.session_sources_list.bind(this)
    );

    return notify;
  }


  /*
  * =========================================================
  * VIEWS
  * =========================================================
  */

  /* A view for one subscription. Every view reads the dataset map and
   * the permission rule for `permission`, and shows nothing until both
   * have answered, unless `opts.required` says otherwise. */
  _view(name, sess, permission, opts) {
    return new DatasetView({
      name,
      principal: sess.principal,
      registry: this.views,
      required: ["data", "check"],
      ...opts,
      sources: {
        data: this.data.changes,
        check: this.data.watch_allowed_check(sess.principal, permission),
        ...opts.sources,
      },
    });
  }

  /* A view of metadata bodies. `parts` is the source of the parts:
   * of every dataset, or of the one dataset the view is for. */
  _metadata_view(name, sess, parts, opts) {
    return this._view(name, sess, Constants.Perm.ReadDataset, {
      body: metadata_body,
      ...opts,
      sources: {
        info: this.data.info_changes,
        meta: this.data.metadata_changes,
        ftypes: this.data.functional_changes,
        parts,
      },
    });
  }

  /* A list of the datasets a principal holds a permission on. */
  _list(name, sess, permission, candidates) {
    return watch_list(this._view(name, sess, permission, {
      candidates,
      body: member_body,
    }));
  }

  /*
  * =========================================================
  * METADATA
  * =========================================================
  */
  // WATCH
  metadata_list(sess) {
    return this._list("metadata_list", sess,
      Constants.Perm.ReadDataset, st => st.data.valid);
  }

  /* WATCH. This answers at once, with a 200 that has no body when it
   * cannot give one yet, and again each time the body changes. An
   * unknown, invalid or not-allowed dataset has no body. A malformed
   * UUID throws, here and in structure_uuid, which closes the client's
   * WebSocket: it always has, and clients may rely on it. */
  metadata_uuid(sess, uuid) {
    if (!valid_uuid(uuid))
      throw new Error("Not a dataset UUID");

    const view = this._metadata_view("metadata_uuid", sess,
      this.data.dataset_parts_changes(uuid),
      { candidates: [uuid], required: [] });
    return watch_key(view, uuid, { always: true });
  }

  /* SEARCH. This answers as soon as the dataset map and the ACL have:
   * a name, kind, metadata entry or part that is not known yet is
   * left out, and a child update follows when it is. */
  metadata_search(sess) {
    return search_source(this._metadata_view("metadata_search", sess,
      this.data.parts_changes,
      { candidates: st => st.data.valid }));
  }

  /*
  * =========================================================
  * STRUCTURE
  * =========================================================
  */

  // WATCH
  structure_list(sess) {
    return this._list("structure_list", sess,
      READ_STRUCTURE, st => st.data.datasets);
  }

  /* WATCH. This sends the structure of a valid dataset and each
   * change to it. It sends nothing for an unknown, invalid or
   * not-allowed dataset, and nothing when the dataset goes away. */
  structure_uuid(sess, uuid) {
    if (!valid_uuid(uuid))
      throw new Error("Not a dataset UUID");

    const view = this._view("structure_uuid", sess, READ_STRUCTURE, {
      candidates: [uuid],
      body: (st, id) => structure_body(st, id, true),
    });
    return watch_key(view, uuid);
  }

  /* SEARCH. An invalid dataset is a child too, with the invalid
   * marker as its structure and a null config, as GET
   * /v1/structure/:uuid gives it. */
  structure_search(sess) {
    return search_source(this._view("structure_search", sess, READ_STRUCTURE, {
      candidates: st => st.data.datasets,
      body: (st, id) => structure_body(st, id, false),
    }));
  }

  /*
  * =========================================================
  * UNION / SESSION SOURCES
  * =========================================================
  * Simple UUID lists (like metadata_list/structure_list above) of the
  * valid datasets the principal is permitted to use as a source in a
  * particular capacity. These are distinct from READ_DATASET/EDIT_DATASET
  * visibility: a principal may be able to see a dataset but not be
  * permitted to embed it in a Union or use it as a Session source.
  */

  // WATCH
  union_sources_list(sess) {
    return this._list("union_sources_list", sess,
      Constants.Perm.IncludeInUnion, st => st.data.valid);
  }

  // WATCH
  session_sources_list(sess) {
    return this._list("session_sources_list", sess,
      Constants.Perm.UseForSession, st => st.data.valid);
  }

}

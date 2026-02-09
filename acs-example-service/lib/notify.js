import * as rx from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";
import { Notify } from "@amrc-factoryplus/service-api";

export class AuthNotify {
  constructor(opts) {
    this.data = opts.data;
    this.log = opts.debug.bound("notify");

    this.notify = this.build_notify(opts.api);
  }

  run() {
    this.log("Running notify server");
    this.notify.run();
  }

  build_notify(api) {
    const notify = new Notify({
      api,
      log: this.log,
    });

    // This is basically Express. This is more strict in that directories must end with a "/". It won't redirect.
    notify.watch("v1/name/", this.name_list.bind(this));
    notify.watch("v1/name/:object", this.object_name.bind(this));

    return notify;
  }

  /**
  * Get names for all objects the principal can see.
  */
  name_list(sess) {
    // We should combine this with the session permissions to see the objects
    return rxx.rx(
      this.data.names,
      rx.map(entries => entries.keySeq().toArray()),
      rx.mergeMap(
        // You need to filter out what they can't see here using `sess` (not in a .filter :))
      ),
      rx.map(
        // You need to build your response objects here
      ));
  }


  /**
  * Get changes to the name of a particular object `obj`.
  */
  object_name(sess, obj) {
    // Do similar to `name_list` here.
  }
}

import { APIError } from "@amrc-factoryplus/service-api";

function fail(status, message) {
  throw new APIError(status);
}

export class APIv1 {
  constructor(opts) {
    this.data = opts.data;
    this.fplus = opts.fplus;
    this.auth = this.fplus.Auth;
    this.log = this.fplus.debug.bound("api-v1");
    this.routes = this.setup_routes();
  }

  setup_routes() {
    let api = express.Router();

    api.route("/name/:uuid")
      .get(this.name_get.bind(this))
      .put(this.name_put.bind(this))

    return api;
  }


  async name_get(req, res) {
    const { uuid } = req.params;

    // This URL could not possibly exist (different from "could exist in the future")
    if (!valid_uuid(uuid)) fail(410);

    const names = await rx.firstValueFrom(this.data.names);
    const name = names.get(uuid);
    if (!name) fail(404);

    const ok = await this.auth.check_acl(
      // Principal
      req.auth,
      // Your own service permission
      Perm.MyGetNamePermission,
      // Target UUID
      uuid,
      // Do we accept wildcards?
      true,
    );

    if (!ok) {
      fail(403);
    }

    return res.status(200).json(name);
  }

  async name_put(req, res) {
    const { uuid } = req.params;
    if (!valid_uuid(uuid)) fail(410);

    // May need this in your own service. We don't in this case. This is checking validity of what you give the service.
    // if (grant && !valid_grant(grant)) fail(422);

    const ok = await this.auth.check_acl(
      req.auth,
      Perm.MyPutNamePermission,
      uuid,
      true,
    );

    if (!ok) {
      fail(403);
    }

    const retval = await this.data.request({ type: "name", object: uuid, name: req.body });
    return res.status(retval.status).end();
  }
}

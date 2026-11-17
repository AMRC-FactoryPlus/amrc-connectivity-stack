# Factory+ User Admin service
# HTTP routes
# Copyright 2026 University of Sheffield

import  logging

import  kadmin

from    flask                           import Blueprint, current_app, g, jsonify, request

from    amrc.factoryplus                import uuids
from    amrc.factoryplus.service_client import ServiceError

from    .kadmin                         import Kadm
from    .uuids                          import Perm

log = logging.getLogger(__name__)

bp = Blueprint("user_admin", __name__)

@bp.post("/v1/user")
def create_user ():
    fplus = current_app.fplus
    auth = fplus.auth

    if not auth.check_acl(g.auth, Perm.ManageUsers, uuids.Null, False):
        return jsonify(error="Forbidden"), 403

    body = request.get_json()
    if not isinstance(body, dict):
        return jsonify(error="Body must be a JSON object"), 400

    missing = [k for k in ("name", "principal", "password") if k not in body]
    if missing:
        return jsonify(error=f"Missing fields: {', '.join(missing)}"), 400

    name = body["name"]
    principal = body["principal"]
    password = body["password"]
    groups = body.get("groups", [])

    if auth.find_principal("kerberos", principal) is not None:
        return jsonify(error=f"Principal {principal} already exists"), 409

    kadm = Kadm(ccache=current_app.config["KADMIN_CCNAME"])
    try:
        kadm.set_password(principal, password)
    except kadmin.KAdminError as e:
        log.error(f"Failed to set password for new principal {principal}: {e}")
        return jsonify(error="Failed to set password"), 500

    # If anything below fails the KDC principal from set_password above
    # is left in place - there is no rollback. This mirrors an
    # already-accepted rough edge elsewhere in the codebase
    # (Auth.create_principal's own XXX comment in
    # lib/js-service-client/lib/service/auth.js about the same class of
    # partial-failure cleanup gap), not a new risk class.
    try:
        obj_uuid = fplus.configdb.create_object(uuids.Class.HumanUser)
        fplus.configdb.put_config(uuids.App.Info, obj_uuid, {"name": name})
        for group in groups:
            fplus.configdb.class_add_member(group, obj_uuid)
        auth.add_identity(obj_uuid, "kerberos", principal)
    except ServiceError as e:
        log.error(f"ConfigDB/Auth provisioning failed for KDC principal "
            f"{principal}, needs manual follow-up: {e}")
        return jsonify(error="Provisioning failed"), 500

    return jsonify(uuid=str(obj_uuid)), 201

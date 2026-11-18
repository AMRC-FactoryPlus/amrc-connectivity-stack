# Factory+ User Admin service
# HTTP routes
# Copyright 2026 University of Sheffield

import  logging

import  kadmin

from    flask                           import Blueprint, current_app, g, jsonify, request

from    amrc.factoryplus                import uuids
from    amrc.factoryplus.service_client import ServiceError

from    .kadmin                         import Kadm, PrincipalExists
from    .uuids                          import Perm

log = logging.getLogger(__name__)

bp = Blueprint("user_admin", __name__)

def qualify_principal (principal, realm):
    """Turn what the caller sent into a full principal in our realm.

    A bare username gets our realm added. A name in another realm, or
    with more than one component (`host/foo`, `krbtgt/REALM`), is
    refused: this service only creates human users in its own realm.

    @returns The qualified principal, or None if it is not acceptable.
    """
    user, at, given_realm = principal.partition("@")
    if not user or "/" in user or "@" in given_realm:
        return None
    if any(c.isspace() for c in principal):
        return None
    if at and given_realm != realm:
        return None
    return f"{user}@{realm}"

@bp.post("/v1/user")
def create_user ():
    fplus = current_app.fplus
    auth = fplus.auth

    if not auth.check_acl(g.auth, Perm.ManageUsers, uuids.Null, False):
        return jsonify(error="Forbidden"), 403

    body = request.get_json()
    if not isinstance(body, dict):
        return jsonify(error="Body must be a JSON object"), 400

    fields = ("name", "principal", "password")
    missing = [k for k in fields if k not in body]
    if missing:
        return jsonify(error=f"Missing fields: {', '.join(missing)}"), 400

    invalid = [k for k in fields
        if not isinstance(body[k], str) or body[k] == ""]
    if invalid:
        return jsonify(
            error=f"Fields must be non-empty strings: {', '.join(invalid)}"), 400

    name = body["name"]
    password = body["password"]

    realm = current_app.config["REALM"]
    principal = qualify_principal(body["principal"], realm)
    if principal is None:
        return jsonify(error=f"Principal must be a single username, "
            f"optionally followed by @{realm}"), 400

    if auth.find_principal("kerberos", principal) is not None:
        return jsonify(error=f"Principal {principal} already exists"), 409

    # The KDC is asked to create the principal, never to find or change
    # one. A principal that is in the KDC but not in the Auth service
    # (a service principal, krbtgt, a user made by hand and not yet
    # linked) must not have its password replaced.
    try:
        kadm = Kadm(ccache=current_app.config["KADMIN_CCNAME"])
        principal = kadm.create_princ(principal, password)
    except PrincipalExists:
        return jsonify(error=f"Principal {principal} already exists in "
            f"the KDC"), 409
    except kadmin.KAdminError as e:
        log.error(f"Failed to create principal {principal}: {e}")
        return jsonify(error="Failed to create Kerberos principal"), 500

    # If anything below fails the KDC principal created above is left in
    # place - there is no rollback. A retry then gets the 409 above, so
    # it cannot create a second ConfigDB object; the account has to be
    # finished by hand with the Link User flow. This mirrors an
    # already-accepted rough edge elsewhere in the codebase
    # (Auth.create_principal's own XXX comment in
    # lib/js-service-client/lib/service/auth.js about the same class of
    # partial-failure cleanup gap), not a new risk class.
    try:
        obj_uuid = fplus.configdb.create_object(uuids.Class.HumanUser)
        fplus.configdb.put_config(uuids.App.Info, obj_uuid, {"name": name})
        auth.add_identity(obj_uuid, "kerberos", principal)
    except ServiceError as e:
        log.error(f"ConfigDB/Auth provisioning failed for KDC principal "
            f"{principal}, needs manual follow-up: {e}")
        return jsonify(error=f"Kerberos principal {principal} was created "
            f"but the Factory+ user was not. Finish it with Link User."), 500

    return jsonify(uuid=str(obj_uuid), principal=principal), 201

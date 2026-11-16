# Factory+ User Admin service
# Inbound HTTP auth: SPNEGO, and Bearer tokens minted from it
# Copyright 2026 University of Sheffield

import  base64
import  logging
import  secrets
import  time

import  gssapi
from    flask    import g, jsonify, request

log = logging.getLogger(__name__)

SESSION_LENGTH = 3 * 3600
DATE_FUZZ = 60

class FplusHttpAuth:
    """Inbound HTTP auth for acs-user-admin. Accepts Negotiate (SPNEGO)
    against our Kerberos keytab, and issues opaque Bearer tokens from
    POST /token which are accepted on subsequent calls. Modeled on
    lib/js-service-api/lib/auth.js's FplusHttpAuth, trimmed to the two
    schemes this service needs - no Basic, no Keycloak JWT."""

    def __init__ (self, session_length=SESSION_LENGTH):
        self.session_length = session_length
        self.tokens = {}

    def setup (self, app):
        self.fplus = app.fplus
        app.before_request(self.auth)
        app.after_request(self.add_negotiate_header)
        app.add_url_rule("/token", "token", self.token, methods=["POST"])

    def auth (self):
        # The browser's CORS preflight never carries an Authorization
        # header, by design - flask-cors only adds headers to the
        # response, it doesn't intercept the request before this hook
        # runs, so this has to let OPTIONS through explicitly.
        if request.method == "OPTIONS":
            return

        auth = request.headers.get("Authorization")
        if not auth:
            log.info("Auth failed: no HTTP auth provided")
            return self._unauthorized()

        scheme, _, creds = auth.partition(" ")

        try:
            if scheme == "Negotiate":
                client = self.auth_gssapi(creds)
            elif scheme == "Bearer":
                client = self.auth_bearer(creds)
            else:
                raise ValueError(f"Unknown authentication scheme {scheme}")
        except Exception as e:
            log.info(f"Auth failed: {e}")
            return self._unauthorized()

        log.info(f"Auth succeeded for [{client}]")
        g.auth = client

    def auth_gssapi (self, creds):
        cli_tok = base64.b64decode(creds)

        ctx = gssapi.SecurityContext(usage="accept")
        srv_tok = ctx.step(cli_tok)

        if not ctx.complete:
            raise ValueError("GSSAPI auth did not complete")

        if srv_tok:
            g.www_authenticate = \
                "Negotiate " + base64.b64encode(srv_tok).decode()

        principal = str(ctx.initiator_name)
        # check_acl always takes a Factory+ principal UUID (the only
        # caller is this service's own routes), not a raw Kerberos UPN,
        # so resolve it here rather than pushing that decision onto
        # every caller of g.auth.
        uuid = self.fplus.auth.find_principal("kerberos", principal)
        if uuid is None:
            raise ValueError(f"No Factory+ identity for {principal}")
        return uuid

    def auth_bearer (self, token):
        client = self.tokens.get(token)
        if client is None:
            raise ValueError("Bad token")
        if client["expiry"] < time.time() + DATE_FUZZ:
            del self.tokens[token]
            raise ValueError("Expired token")
        return client["principal"]

    def token (self):
        token = secrets.token_urlsafe(66)
        expiry = time.time() + self.session_length
        self.tokens[token] = {"principal": g.auth, "expiry": expiry}

        log.info(f"Created token for {g.auth}")
        return jsonify({"token": token, "expiry": expiry})

    def add_negotiate_header (self, response):
        www_authenticate = g.pop("www_authenticate", None)
        if www_authenticate:
            response.headers["WWW-Authenticate"] = www_authenticate
        return response

    def _unauthorized (self):
        return "", 401, {"WWW-Authenticate": "Negotiate"}

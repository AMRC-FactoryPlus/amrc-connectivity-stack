# Factory+ User Admin service
# Inbound HTTP auth: SPNEGO, and Bearer tokens minted from it
# Copyright 2026 University of Sheffield

import  base64
import  logging
import  secrets
import  time

import  gssapi
import  krb5
from    flask    import g, jsonify, request

from    .jwt     import AuthUnavailable, JwtVerifier, looks_like_jwt

log = logging.getLogger(__name__)

SESSION_LENGTH = 3 * 3600
DATE_FUZZ = 60

class FplusHttpAuth:
    """Inbound HTTP auth for acs-user-admin. Accepts Basic and Negotiate
    (SPNEGO) against our Kerberos keytab, Keycloak-issued JWTs, and
    opaque Bearer tokens issued from POST /token. Modeled on
    lib/js-service-api/lib/auth.js's FplusHttpAuth."""

    def __init__ (self, session_length=SESSION_LENGTH):
        self.session_length = session_length
        self.tokens = {}

    def setup (self, app):
        self.fplus = app.fplus
        self.realm = app.config["REALM"]

        # Keycloak JWT acceptance. Lazy: discovery/JWKS are only
        # fetched on the first JWT we actually see. None (the admin
        # UI's OIDC switch is off, or REALM-only deployments) turns
        # this off and opaque Bearer tokens keep working unchanged.
        discovery_url = app.config.get("OIDC_DISCOVERY_URL")
        self.jwt = JwtVerifier(discovery_url) if discovery_url else None

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
            if scheme == "Basic":
                client = self.auth_basic(creds)
            elif scheme == "Negotiate":
                client = self.auth_gssapi(creds)
            elif scheme == "Bearer":
                client = self.auth_bearer(creds)
            else:
                raise ValueError(f"Unknown authentication scheme {scheme}")
        except AuthUnavailable as e:
            # A 503 tells the caller their credentials may well be
            # fine - we just couldn't check them - so they don't throw
            # away a still-good JWT because Keycloak had a blip.
            log.info(f"Auth unavailable: {e}")
            return "", 503, {"Content-Type": "text/plain"}
        except Exception as e:
            log.info(f"Auth failed: {e}")
            return self._unauthorized()

        log.info(f"Auth succeeded for [{client}]")
        g.auth = client

    def auth_basic (self, creds):
        user, _, password = base64.b64decode(creds).decode().partition(":")
        client = user if "@" in user else f"{user}@{self.realm}"

        # Verifies the password against the KDC directly - equivalent
        # to a kinit, the same check GSS.verifyCredentials does in the
        # JS auth.js this is modeled on.
        ctx = krb5.init_context()
        princ = krb5.parse_name_flags(ctx, client.encode())
        opts = krb5.get_init_creds_opt_alloc(ctx)
        krb5.get_init_creds_password(ctx, princ, opts, password=password.encode())

        uuid = self.fplus.auth.find_principal("kerberos", client)
        if uuid is None:
            raise ValueError(f"No Factory+ identity for {client}")
        return uuid

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
        # Keycloak JWT? Structural test, no network call.
        if self.jwt and looks_like_jwt(token):
            return self.auth_jwt(token)

        client = self.tokens.get(token)
        if client is None:
            raise ValueError("Bad token")
        if client["expiry"] < time.time() + DATE_FUZZ:
            del self.tokens[token]
            raise ValueError("Expired token")
        return client["principal"]

    def auth_jwt (self, token):
        payload = self.jwt.verify(token)

        # The acs-keycloak-spi protocol mapper stamps fp_principal_uuid
        # on every token issued by our realm. A JWT without it isn't
        # one of ours, even if the signature is valid.
        principal = payload.get("fp_principal_uuid")
        if not principal:
            raise ValueError("JWT missing fp_principal_uuid claim")
        return principal

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
        return "", 401, {"WWW-Authenticate": 'Basic realm="Factory+"'}

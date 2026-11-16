# Factory+ User Admin service
# Flask application entrypoint
# Copyright 2026 University of Sheffield

import  logging
import  os

from    flask                           import Flask
from    flask_cors                      import CORS

from    amrc.factoryplus.service_client import ServiceClient

from    .lib.auth                       import FplusHttpAuth
from    .lib.routes                     import bp

log = logging.getLogger(__name__)

# Without this, every log.info() in lib/auth.py and lib/routes.py is
# silently dropped (the root logger defaults to WARNING), leaving only
# werkzeug's bare access log line on an auth failure - no indication of
# which scheme was tried or why it was rejected.
logging.basicConfig(level=logging.INFO)

def create_app (env=None):
    if env is None:
        env = os.environ

    app = Flask(__name__)
    app.fplus = ServiceClient(env=env)
    app.config["KADMIN_CCNAME"] = env.get("KADMIN_CCNAME")
    app.config["REALM"] = env.get("REALM")

    # The Admin UI calls this service cross-origin from its own
    # subdomain, same as every JS service via lib/js-service-api's
    # WebAPI (cors({credentials: true, maxAge: 86400})). This only adds
    # response headers - it does not intercept the request before
    # FplusHttpAuth's before_request hook runs, so that hook has its
    # own explicit OPTIONS bypass (see lib/auth.py).
    CORS(app, supports_credentials=True, max_age=86400)

    app.auth = FplusHttpAuth()
    app.auth.setup(app)
    app.register_blueprint(bp)

    return app

if __name__ == "__main__":
    # Local dev only - gunicorn (see the Dockerfile/Deployment) is the
    # real entrypoint, invoking create_app() directly.
    create_app().run(host="0.0.0.0", port=8080)

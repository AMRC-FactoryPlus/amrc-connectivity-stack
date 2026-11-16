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

def create_app (env=None):
    if env is None:
        env = os.environ

    app = Flask(__name__)
    app.fplus = ServiceClient(env=env)
    app.config["KADMIN_CCNAME"] = env.get("KADMIN_CCNAME")

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
    create_app().run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))

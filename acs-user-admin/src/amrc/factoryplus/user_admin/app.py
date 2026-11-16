# Factory+ User Admin service
# Flask application entrypoint
# Copyright 2026 University of Sheffield

import  logging
import  os

from    flask                           import Flask

from    amrc.factoryplus.service_client import ServiceClient

from    .lib.auth                       import FplusHttpAuth

log = logging.getLogger(__name__)

def create_app (env=None):
    if env is None:
        env = os.environ

    app = Flask(__name__)
    app.fplus = ServiceClient(env=env)

    FplusHttpAuth().setup(app)

    return app

if __name__ == "__main__":
    create_app().run()

# syntax=docker/dockerfile:1

FROM alpine AS build

WORKDIR /root
# We can't use a bind mount here, pip does in-tree builds. Copy only
# the lib we need, or any change elsewhere in lib/ reruns the pip
# install below, which compiles krb5 and gssapi from source.
COPY --from=lib py-python-kadmv /acs-lib/py-python-kadmv
COPY --from=lib py-service-client /acs-lib/py-service-client
COPY requirements.txt .
RUN /bin/sh <<SHELL
    set -e

    apk add bison curl python3 py3-pip python3-dev gcc musl-dev krb5 krb5-dev
    pip install -t /usr/local/python -r requirements.txt
SHELL

FROM alpine

RUN apk add python3 krb5 kstart \
    && adduser -D -g "User admin service" useradmin

COPY --from=build /usr/local/python /usr/local/python

WORKDIR /home/useradmin
COPY src src

USER useradmin
ENV PATH=/usr/local/python/bin:/usr/local/bin:/usr/bin:/bin
ENV PYTHONPATH=/home/useradmin/src:/usr/local/python
CMD ["python3", "-m", "amrc.factoryplus.user_admin.app"]

# syntax=docker/dockerfile:1

FROM alpine AS build

ARG kubeseal_ver=0.19.5

WORKDIR /root
# We can't use a bind mount here, pip does in-tree builds
COPY --from=lib . /acs-lib
COPY requirements.txt .
RUN /bin/sh <<SHELL
    set -e

    apk add bison curl python3 py3-pip python3-dev gcc musl-dev krb5 krb5-dev
    pip install -t /usr/local/python -r requirements.txt
    curl -L https://github.com/bitnami-labs/sealed-secrets/releases/download/v${kubeseal_ver}/kubeseal-${kubeseal_ver}-linux-amd64.tar.gz \
        | tar -xzvf - -C /usr/local/bin kubeseal
SHELL

FROM alpine

RUN apk add python3 krb5 kstart \
    && adduser -D -g "Kerberos key manager" krbkeys

COPY --from=build /usr/local/python /usr/local/python
COPY --from=build /usr/local/bin /usr/local/bin

WORKDIR /home/krbkeys
COPY . .

USER krbkeys
ENV PATH=/usr/local/python/bin:/usr/local/bin:/usr/bin:/bin
ENV PYTHONPATH=/home/krbkeys/lib:/usr/local/python
CMD /bin/sh /home/krbkeys/bin/krb-keys.sh

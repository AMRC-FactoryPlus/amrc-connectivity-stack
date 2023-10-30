FROM alpine AS build

ARG kubeseal_ver=0.19.5

RUN apk add curl python3 py3-pip python3-dev gcc musl-dev krb5 krb5-dev \
    && pip install -t /usr/local/python krb5 python-kadmV kubernetes kopf \
        optional.py requests requests-cache requests-kerberos \
    && curl -L https://github.com/bitnami-labs/sealed-secrets/releases/download/v${kubeseal_ver}/kubeseal-${kubeseal_ver}-linux-amd64.tar.gz | tar -xzvf - -C /usr/local/bin kubeseal

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

FROM alpine

RUN apk add --update krb5 krb5-server \
    # Be explicit about the UID, we need it for the k8s config.
    && adduser -S -u 100 -g "KDC user account" kdc \
    # This is worth doing but the permissions will need resetting if we
    # mount a volume over here.
    && install -d -o kdc -g nogroup -m 700 /var/lib/krb5kdc

COPY init-kdb.sh /usr/sbin/init-kdb.sh

USER kdc

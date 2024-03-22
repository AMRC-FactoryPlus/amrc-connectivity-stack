#!/bin/sh

echo "Running krb-keys.sh"

split () {
    local string="$1" IFS="$2" opt="$3"
    for s in $string
    do
        echo -n "$opt $s "
    done
}

if [ -z "$WATCH_NAMESPACES" ]
then
    WATCH_NAMESPACES="$(cat /run/secrets/kubernetes.io/serviceaccount/namespace)"
fi

ns_args="$(split "$WATCH_NAMESPACES" , -n)"

kopf run --standalone $ns_args -m amrc.factoryplus.krbkeys

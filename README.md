# ACS KerberosKeys Operator

> The AMRC Connectivity Stack is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk/).

This is a Kubernetes operator to manage Kerberos credentials via the
Kubernetes API.

## Upgrading

When upgrading from v1.0.1, the following commands need to be run, from
a Unix shell with `kubectl` access to the cluster:

```
label="app.kubernetes.io/managed-by=krbkeys.factoryplus.app.amrc.co.uk"
kubectl get -o jsonpath="{.items[*].spec.secret}" krbs \
    | xargs -n1 echo | sed -e's!/.*!!' | sort -u \
    | xargs -I% kubectl label secret % "$label"
kubectl label secret krb5-keytabs "$label"
kubectl label secret krb5-passwords "$label"
```

Substitute in the names of your `KEYTABS_SECRET` and `PASSWORDS_SECRET`
if you have used something else. This will need to be repeated for any
namespace that has KerberosKey objects in it. This sets labels required
by the new version of the operator to ensure that we don't overwrite
secrets we didn't create.

Be aware that neither the operator nor the KDC will not start until this
has been done.

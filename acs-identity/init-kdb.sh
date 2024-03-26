#!/bin/sh

# Run as the user the KDC will run as. Make sure the KDC's database
# directory (normally /var/lib/krb5kdc) already has correct ownership.

if [ -f "/var/lib/krb5kdc/principal" ]
then
    echo "KDB already exists."
    exit 0
fi

# Create the KDB with a random master password and stash the key. There
# are no KDB operations that need to know the password if we have a
# stash file, so if we want to separate the stash from the KDB later
# that won't cause any problems.
passwd="$(head -c64 /dev/random | base64 -w0)"
kdb5_util create -s -P "$passwd"

#!/bin/sh
# ACS Edge Agent
# Split-driver cluster rig: the mock image's entrypoint
# Copyright 2026 University of Sheffield
#
#   rig <command> [args...]
#
# Commands: run-mocks, make-rig, load, remove, check, local, write,
# batched. See
# docs/development/split-driver-cluster-test.md.

set -e
cmd="$1"
case "$cmd" in
    run-mocks|make-rig|load|remove|check|local|write|batched) shift ;;
    *)
        echo "Usage: rig run-mocks|make-rig|load|remove|check|local|write|batched [args...]" >&2
        exit 2
        ;;
esac
exec node /usr/app/build/tests/rig/"$cmd".js "$@"

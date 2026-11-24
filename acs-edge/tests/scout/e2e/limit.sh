#!/bin/sh
# ACS Edge Agent
# Edge Scout end-to-end tests: run a command in a cgroup with the Edge
# Agent's CPU and memory limits from the edge-agent chart
# Copyright 2026 University of Sheffield
#
# limit.sh <cpu millicores> <memory MiB> <command...>
#
# Needs root and a writable cgroup v2 hierarchy, as on a CI runner
# through sudo or in a privileged container. Swap is turned off for the
# cgroup, so going over the memory limit kills the command, as it does
# in Kubernetes. Set LIMIT_UID and LIMIT_GID to run the command as that
# user once it is inside the cgroup.
set -eu

cpu_m=$1; mem_mi=$2; shift 2
root=/sys/fs/cgroup
[ -f "$root/cgroup.controllers" ] || { echo "limit.sh: no cgroup v2 at $root" >&2; exit 2; }

# A cgroup with processes of its own can't hand controllers to its
# children, except the real root. Inside a container the namespace's
# root is not the real root, so move its processes into a leaf first.
if ! grep -qw cpu "$root/cgroup.subtree_control" || ! grep -qw memory "$root/cgroup.subtree_control"; then
    if ! echo "+cpu +memory" > "$root/cgroup.subtree_control" 2>/dev/null; then
        mkdir -p "$root/init"
        for p in $(cat "$root/cgroup.procs"); do
            echo "$p" > "$root/init/cgroup.procs" 2>/dev/null || true
        done
        echo "+cpu +memory" > "$root/cgroup.subtree_control"
    fi
fi

cg="$root/scout-e2e-agent-$$"
mkdir "$cg"
echo "$((cpu_m * 100)) 100000" > "$cg/cpu.max"
echo "$((mem_mi * 1024 * 1024))" > "$cg/memory.max"
[ -f "$cg/memory.swap.max" ] && echo 0 > "$cg/memory.swap.max"
echo $$ > "$cg/cgroup.procs"
echo "limit.sh: $cg cpu.max=$(cat "$cg/cpu.max") memory.max=$(cat "$cg/memory.max")" >&2

if [ -n "${LIMIT_UID:-}" ]; then
    exec setpriv --reuid="$LIMIT_UID" --regid="${LIMIT_GID:-$LIMIT_UID}" --clear-groups "$@"
fi
exec "$@"

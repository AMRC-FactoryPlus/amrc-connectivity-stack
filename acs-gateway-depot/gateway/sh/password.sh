# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Sets a random admin password. Sourced by configure.sh.
#
# This only runs when someone is at a terminal to write the password down.
# An unattended install sets the password in the installer instead.

if [ "$ADMIN_PASSWORD" = random ]; then
    admin_user="${SUDO_USER:-}"
    if [ -z "$admin_user" ] || [ "$admin_user" = root ] || [ ! -t 0 ]; then
        warn "ADMIN_PASSWORD=random needs an interactive sudo run, so the password is unchanged."
    else
        new_password="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || true)"
        cat >/dev/tty <<MSG

The password for ${admin_user} will change to: ${new_password}
Make a note of it now, then press Enter, or Ctrl-C to stop.
MSG
        read -r _ </dev/tty
        echo "${admin_user}:${new_password}" | chpasswd
        unset new_password
        # Remove the password from the screen.
        tput cuu 4 >/dev/tty 2>/dev/null && tput ed >/dev/tty 2>/dev/null || true
        log "Changed the password for ${admin_user}"
    fi
fi

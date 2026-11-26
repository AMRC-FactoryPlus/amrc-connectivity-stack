# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Package sources and automatic updates. Sourced by configure.sh.

need_root

codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"

if [ -n "$APT_MIRROR" ]; then
    keytmp="$(mktemp)"
    if [ -n "$APT_MIRROR_KEY" ]; then
        log "Using the apt mirror signing key from the gateway settings"
        printf '%s' "$APT_MIRROR_KEY" | base64 -d > "$keytmp" 2>/dev/null \
            || die "APT_MIRROR_KEY is not valid base64."
        [ -s "$keytmp" ] || die "APT_MIRROR_KEY is empty once decoded."
    else
        [ -n "$APT_MIRROR_KEY_SHA256" ] \
            || die "APT_MIRROR is set, so APT_MIRROR_KEY or APT_MIRROR_KEY_SHA256 must be set too."
        log "Fetching the apt mirror signing key"
        curl -fsS -o "$keytmp" "$APT_MIRROR/keyring.gpg" || die "Could not fetch $APT_MIRROR/keyring.gpg"
    fi
    if [ -n "$APT_MIRROR_KEY_SHA256" ]; then
        echo "$APT_MIRROR_KEY_SHA256  $keytmp" | sha256sum -c --quiet \
            || die "The apt mirror signing key does not match APT_MIRROR_KEY_SHA256."
    fi
    # apt only reads an ASCII-armored key from a file named .asc.
    if grep -q -- "-----BEGIN PGP PUBLIC KEY BLOCK-----" "$keytmp"; then
        keyfile=/etc/apt/keyrings/fplus-mirror.asc
        rm -f /etc/apt/keyrings/fplus-mirror.gpg
    else
        keyfile=/etc/apt/keyrings/fplus-mirror.gpg
        rm -f /etc/apt/keyrings/fplus-mirror.asc
    fi
    install -D -m 644 "$keytmp" "$keyfile"
    rm -f "$keytmp"

    # Updates and security fixes are published as their own suites. Use
    # each one the mirror carries, so a mirror that only holds the
    # release still works.
    suites="$codename"
    for suite in "$codename-updates" "$codename-security"; do
        if curl -fs -o /dev/null "$APT_MIRROR/dists/$suite/InRelease" \
            || curl -fs -o /dev/null "$APT_MIRROR/dists/$suite/Release"
        then
            suites="$suites $suite"
        else
            warn "The apt mirror has no $suite suite, so this gateway will not get the updates published there."
        fi
    done

    log "Pointing apt at $APT_MIRROR ($suites)"
    backup="$GW_BACKUP/apt-$(date +%Y%m%dT%H%M%S)"
    mkdir -p "$backup"
    cp -a /etc/apt/sources.list /etc/apt/sources.list.d "$backup/" 2>/dev/null || true
    rm -f /etc/apt/sources.list.d/*
    : > /etc/apt/sources.list
    cat > /etc/apt/sources.list.d/fplus-mirror.sources <<SOURCES
Types: deb
URIs: $APT_MIRROR
Suites: $suites
Components: main restricted universe multiverse
Signed-By: $keyfile
SOURCES
    apt-get update

    # Automatic updates only install from sources they are told to
    # trust. Use the mirror's origin if it has one. Otherwise match on
    # its host, because some mirrors' Release files have no Origin line.
    if [ -n "$APT_MIRROR_ORIGIN" ]; then
        pattern="origin=$APT_MIRROR_ORIGIN"
    else
        host="${APT_MIRROR#*://}"
        host="${host%%/*}"
        host="${host%:*}"
        pattern="site=$host"
    fi
    cat > /etc/apt/apt.conf.d/90fplus-gw-origins <<APT
Unattended-Upgrade::Origins-Pattern {
    "$pattern";
};
APT
else
    log "Keeping the Ubuntu package sources (no apt mirror set)"
    rm -f /etc/apt/apt.conf.d/90fplus-gw-origins
fi

log "Configuring automatic updates (03:30 download, 04:00 install, reboot if needed)"
systemd_dir=/etc/systemd/system
mkdir -p "$systemd_dir/apt-daily.timer.d" "$systemd_dir/apt-daily-upgrade.timer.d"
cat > "$systemd_dir/apt-daily.timer.d/90fplus-gw.conf" <<'SYSTEMD'
[Timer]
OnCalendar=
OnCalendar=*-*-* 03:30
Persistent=true
RandomizedDelaySec=2m
SYSTEMD
cat > "$systemd_dir/apt-daily-upgrade.timer.d/90fplus-gw.conf" <<'SYSTEMD'
[Timer]
OnCalendar=
OnCalendar=*-*-* 04:00
Persistent=true
RandomizedDelaySec=2m
SYSTEMD
cat > /etc/apt/apt.conf.d/90fplus-gw <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
// Ubuntu only installs security fixes by default. Bug fixes are
// published in -updates, so allow those too.
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-updates";
};
APT

systemctl daemon-reload

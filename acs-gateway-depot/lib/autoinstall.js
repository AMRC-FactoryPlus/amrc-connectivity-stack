/*
 * ACS Gateway Depot
 * Builds the Ubuntu installer settings for one gateway.
 * Copyright 2026 University of Sheffield AMRC
 */

import crypto               from "node:crypto";
import { execFileSync }     from "node:child_process";

/* A password that is easy to read aloud and type: no 0/O or 1/l/I. */
export function random_password (length = 16) {
    const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.randomBytes(length), b => alphabet[b % alphabet.length]).join("");
}

/* The installer wants a SHA-512 crypt hash, which Node cannot make. */
export function hash_password (password) {
    return execFileSync("openssl", ["passwd", "-6", "-stdin"], { input: password })
        .toString().trim();
}

function shell_quote (value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/* The gateway.conf for this gateway. K3S_DEFER makes the first boot stop
 * before K3s, because the cluster must be created on the gateway's final
 * network and not on the bench. */
export function gateway_conf (settings) {
    const lines = {
        ROLE:           "gateway",
        K3S_DEFER:      "yes",
        NORTH_IF:       settings.north_mac,
        SOUTH_IF:       settings.south_mac || "none",
        SOUTH_ADDR:     settings.south_addr || "",
        /* Set when this gateway replaces another and keeps its name. */
        GW_HOSTNAME:    settings.hostname ?? "",
        REGISTRY_MIRROR: settings.registry_mirror ?? "",
        APT_MIRROR:     settings.apt_mirror ?? "",
        /* gateway.conf is line-based, so the key goes in as one line of
         * base64. */
        APT_MIRROR_KEY: settings.apt_mirror_key
            ? Buffer.from(settings.apt_mirror_key).toString("base64") : "",
        APT_MIRROR_KEY_SHA256: settings.apt_mirror_key_sha256 ?? "",
        APT_MIRROR_ORIGIN: settings.apt_mirror_origin ?? "",
    };
    return "# Written by the Gateway Depot.\n"
        + Object.entries(lines).map(([k, v]) => `${k}=${shell_quote(v)}`).join("\n") + "\n";
}

/* Write a file inside the installed system from a late-command. Base64
 * keeps quoting out of it. */
function write_file (target, content, mode) {
    const b64 = Buffer.from(content).toString("base64");
    return `echo ${b64} | base64 -d > /target${target} && chmod ${mode} /target${target}`;
}

export function build_autoinstall (opts) {
    const { box, settings, payload, public_url, progress_token } = opts;
    const k3s = payload.k3s_for(box.inventory.arch);
    const curl = "curl -fsS --retry 5 --retry-delay 3"
        + (settings.has_ca ? " --cacert /cdrom/fplus-gw/ca.pem" : "");

    return {
        autoinstall: {
            version:    1,
            locale:     settings.locale,
            keyboard:   { layout: settings.keyboard },
            timezone:   settings.timezone,
            identity:   {
                hostname:   "fpcgw-new",
                username:   settings.admin_user,
                password:   box.password_hash,
            },
            ssh: {
                "install-server":   true,
                "allow-pw":         true,
                "authorized-keys":  settings.ssh_keys ?? [],
            },
            storage:    { layout: { name: "direct", match: { path: settings.disk } } },
            apt:        { fallback: "offline-install" },
            updates:    "security",
            shutdown:   "poweroff",
            /* Keep the installer's own screen output, and also post each
             * event to the depot so the Admin UI can show progress. A
             * failed post is logged by the installer and ignored. */
            ...(progress_token ? { reporting: {
                builtin:    { type: "print" },
                depot:      {
                    type:       "webhook",
                    endpoint:   `${public_url}/v1/box/${box.id}/progress/${progress_token}`,
                    level:      "INFO",
                },
            } } : {}),
            "late-commands": [
                "mkdir -p /target/opt/fplus-gw/payload /target/etc/fplus-gw",
                "chmod 700 /target/etc/fplus-gw",
                `${curl} -o /tmp/gateway.tar.gz ${public_url}/v1/payload/gateway-${payload.archive_sha}.tar.gz`,
                `echo "${payload.archive_sha}  /tmp/gateway.tar.gz" | sha256sum -c`,
                "tar -xzf /tmp/gateway.tar.gz -C /target/opt/fplus-gw",
                `${curl} -o /target/opt/fplus-gw/payload/k3s-${box.inventory.arch} ${public_url}/v1/payload/k3s-${box.inventory.arch}`,
                `echo "${k3s.sha}  /target/opt/fplus-gw/payload/k3s-${box.inventory.arch}" | sha256sum -c`,
                write_file("/etc/fplus-gw/gateway.conf", gateway_conf(settings), 600),
                "install -m 600 /run/fplus-gw/depot.json /target/etc/fplus-gw/depot.json",
                "if [ -f /cdrom/fplus-gw/ca.pem ]; then install -m 644 /cdrom/fplus-gw/ca.pem /target/etc/fplus-gw/ca.pem; fi",
                "cp /target/opt/fplus-gw/units/*.service /target/etc/systemd/system/",
                "curtin in-target -- systemctl enable fplus-gw-firstboot.service fplus-gw-agent.service",
                "python3 /cdrom/fplus-gw/agent.py report installed || true",
            ],
            /* If anything above fails, say so, so the page does not show
             * "installing" for ever. */
            "error-commands": [
                "python3 /cdrom/fplus-gw/agent.py report install-failed || true",
            ],
        },
    };
}

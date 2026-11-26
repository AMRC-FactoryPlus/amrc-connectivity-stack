/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Edge cluster enrolment tokens
 * Copyright 2026 University of Sheffield AMRC
 */

/* An edge cluster joins the central cluster by creating keys for its
 * krbkeys and flux accounts. Creating keys needs rights in the KDC. The
 * bootstrap script used to ask a person for an administrator's
 * credentials to do this.
 *
 * An enrolment token removes the administrator from the process. It is
 * the password of a Kerberos principal, op1enrol/<cluster>, which we
 * create here with a short expiry. The KDC ACL allows that principal to
 * manage op1krbkeys/<cluster> and op1flux/<cluster> and nothing else.
 * So a token is only good for one cluster, the KDC enforces its expiry,
 * and it carries no Factory+ permissions as the principal has no
 * account in the Auth service.
 *
 * We have no kadmin library, so we drive the kadmin client. Commands go
 * to its stdin so the password never appears in a process listing. */

import child_process    from "child_process";
import crypto           from "crypto";

const TOKEN_MINUTES = 30;

export class Enrolment {
    constructor (opts) {
        this.realm      = opts.realm;
        this.keytab     = opts.keytab;
        this.client     = opts.principal;

        this.log = opts.fplus.debug.bound("enrol");
    }

    principal (name) {
        return `op1enrol/${name}@${this.realm}`;
    }

    /* Run kadmin commands as our own principal. Resolves to kadmin's
     * output. kadmin exits 0 whether or not the commands succeeded so
     * the caller must check the output. */
    kadmin (commands) {
        const args = ["-k", "-t", this.keytab, "-p", this.client,
            "-r", this.realm];

        return new Promise((resolve, reject) => {
            const proc = child_process.spawn("kadmin", args,
                { stdio: ["pipe", "pipe", "pipe"] });
            const out = [];
            proc.stdout.on("data", d => out.push(d));
            proc.stderr.on("data", d => out.push(d));
            proc.on("error", reject);
            proc.on("close", () => resolve(Buffer.concat(out).toString()));
            proc.stdin.end(commands.map(c => `${c}\n`).join(""));
        });
    }

    /* Create a fresh token for a cluster. Any earlier token for the
     * same cluster stops working. */
    async issue (name) {
        /* Cluster names are Sparkplug Group-IDs, but the name goes into
         * a kadmin command line so be certain. */
        if (!/^[A-Za-z0-9_-]+$/.test(name))
            throw new Error(`Unsafe cluster name ${name}`);

        const princ = this.principal(name);
        const token = crypto.randomBytes(24).toString("base64url");

        const out = await this.kadmin([
            `delete_principal -force ${princ}`,
            `add_principal -pw ${token} -expire "now + ${TOKEN_MINUTES} minutes" ${princ}`,
        ]);
        if (!out.includes(`Principal "${princ}" created`)) {
            /* The output cannot contain the token: kadmin does not echo
             * its commands. */
            this.log("Failed to create %s: %s", princ, out);
            throw new Error(`Cannot create enrolment principal for ${name}`);
        }

        this.log("Issued enrolment token for %s", name);
        return {
            principal:  princ,
            token,
            expires:    Date.now() + TOKEN_MINUTES * 60 * 1000,
        };
    }

    /* The principals an edge cluster has in the KDC: the two that
     * enrolment makes, the two the edge krbkeys makes, and the
     * enrolment token. */
    static cluster_principals = ["op1krbkeys", "op1flux", "op1sync",
        "op1monitor", "op1enrol"];

    /* Remove every principal of a deleted cluster, so its keys stop
     * working. The KDC ACL lets us delete these and nothing else.
     * Principals which are not there are not an error. */
    async delete_cluster_principals (name) {
        if (!/^[A-Za-z0-9_-]+$/.test(name))
            throw new Error(`Unsafe cluster name ${name}`);

        const princs = Enrolment.cluster_principals
            .map(p => `${p}/${name}@${this.realm}`);
        const out = await this.kadmin(
            princs.map(p => `delete_principal -force ${p}`));

        /* kadmin says `Principal "P" deleted.` or `... Principal does
         * not exist while deleting principal "P"`, one line each. */
        const lines = out.split("\n");
        for (const p of princs) {
            const line = lines.find(l => l.includes(`"${p}"`)) ?? "";
            if (line.includes("deleted."))
                this.log("Deleted principal %s", p);
            else if (!line.includes("does not exist"))
                this.log("Could not delete %s: %s", p, line || out);
        }
    }

    /* Remove a cluster's token. It is not an error if there is none. */
    async revoke (name) {
        if (!/^[A-Za-z0-9_-]+$/.test(name))
            throw new Error(`Unsafe cluster name ${name}`);

        const princ = this.principal(name);
        await this.kadmin([`delete_principal -force ${princ}`]);
        this.log("Revoked enrolment token for %s", name);
    }
}

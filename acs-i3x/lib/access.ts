/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Access: what each caller may see of the tree.
 *
 * A caller sees a device, and everything below it, when they hold
 * ReadObject on one of:
 *  - the device itself;
 *  - a class the device is a member of (a plural grant, which the Auth
 *    service expands to the members);
 *  - an ISA-95 vocabulary node the device's hierarchy resolves through
 *    (see isa95.ts);
 *  - the wildcard, which covers every device.
 * An ISA-95 level is seen when it is under a granted node, or when
 * something below it is seen, so the path down to a granted device is
 * there to browse. Everything else is hidden, and the API answers for
 * a hidden object exactly as for one that does not exist.
 *
 * Grants come from the caller's ACL, which RxClient keeps current from
 * the Auth service's notify interface. Where the devices and levels sit
 * comes from the tree, and the node names from the vocabulary; all
 * three are read again only when they change.
 */

import * as rx from "rxjs";

import { NULL_UUID, Perm } from "./constants.js";
import type { Placement, Visible } from "./object-tree.js";

/** The ReadObject targets a caller holds. */
export interface Grants {
    /** The wildcard, or the root principal: everything is visible. */
    all: boolean;
    /** Device, ISA-95 node and other target UUIDs. */
    targets: ReadonlySet<string>;
}

export const NO_GRANTS: Grants = Object.freeze({ all: false, targets: new Set<string>() });
export const ALL_GRANTS: Grants = Object.freeze({ all: true, targets: new Set<string>() });

interface Ace { permission: string; target: string }

/** A principal's live view, for one subscription. */
export interface Viewer {
    visible(elementId: string): boolean;
    stop(): void;
}

interface AuthLike {
    root_principal?: string;
    decode_principal(principal: unknown): [string | null, string | null];
    fetch_auth_acl(type: string, principal: string): Promise<Ace[]>;
    watch_acl(principal: unknown): rx.Observable<Ace[]>;
}

interface TreeLike {
    placement(): Placement;
    deviceOf(elementId: string): string | null;
}

interface VocabularyLike {
    revision(): number;
    resolve(chain: string[]): string | null;
}

interface AccessOpts {
    auth: AuthLike;
    objectTree: TreeLike;
    vocabulary: VocabularyLike;
    log?: (msg: string, ...args: any[]) => void;
}

/** The vocabulary node of each ISA-95 level in the tree. */
interface LevelIndex {
    placement: Placement;
    vocabRev: number;
    vocabOf: Map<string, string | null>;
}

/** What one set of grants sees, for one placement and vocabulary. */
interface View {
    index: LevelIndex;
    /** Levels at or under a granted node: everything below is seen. */
    covered: Set<string>;
    /** Levels on the way down to something seen. */
    path: Set<string>;
}

function failed(status: number, message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
}

export class Access {
    private auth: AuthLike;
    private tree: TreeLike;
    private vocabulary: VocabularyLike;
    private log: (msg: string, ...args: any[]) => void;
    /* RxClient hands out the same ACL array until the ACL changes. */
    private fromAcl: WeakMap<Ace[], Grants> = new WeakMap();
    private views: WeakMap<Grants, View> = new WeakMap();
    private levelIndex: LevelIndex | null = null;

    constructor(opts: AccessOpts) {
        this.auth = opts.auth;
        this.tree = opts.objectTree;
        this.vocabulary = opts.vocabulary;
        this.log = opts.log ?? (() => {});
    }

    /**
     * The grants of the principal FplusHttpAuth put on req.auth: a
     * Kerberos UPN or a principal UUID. An ACL the Auth service refuses
     * (an unknown principal) grants nothing; an Auth service we cannot
     * reach is a 503, never a grant.
     */
    async grants(principal: unknown): Promise<Grants> {
        const [type, name] = this.decode(principal);
        if (!type || !name) return NO_GRANTS;
        if (this.isRoot(type, name)) return ALL_GRANTS;

        let acl: Ace[];
        try {
            acl = await this.auth.fetch_auth_acl(type, name);
        } catch (err: any) {
            const st = err?.status;
            if (Number.isInteger(st) && st >= 400 && st < 500) {
                this.log("Auth refused the ACL for %s: %s", name, st);
                return NO_GRANTS;
            }
            console.error("Access: cannot read the ACL for %s:", name, err?.message ?? err);
            throw failed(503, "Auth service unavailable");
        }
        return this.toGrants(acl);
    }

    /** The principal's grants, again on every change to their ACL. */
    watch(principal: unknown): rx.Observable<Grants> {
        const [type, name] = this.decode(principal);
        if (!type || !name) return rx.of(NO_GRANTS);
        if (this.isRoot(type, name)) return rx.of(ALL_GRANTS);
        return this.auth.watch_acl(principal).pipe(rx.map(acl => this.toGrants(acl)));
    }

    /**
     * Follow a principal's grants for as long as a subscription lives.
     * Until the first ACL arrives, and after an error, nothing is
     * visible.
     */
    track(principal: unknown): Viewer {
        let current: Grants | null = null;
        const sub = this.watch(principal).subscribe({
            next: g => { current = g; },
            error: err => {
                current = null;
                console.error("Access: following the ACL failed:", err?.message ?? err);
            },
        });
        return {
            visible: id => current !== null && this.visibleNow(current, id),
            stop: () => sub.unsubscribe(),
        };
    }

    /** A check for the tree's read methods, or undefined when the
     * grants see everything (no filtering at all). */
    visible(grants: Grants): Visible | undefined {
        if (grants.all) return undefined;
        return (elementId, deviceUuid) => deviceUuid !== null
            ? this.deviceVisible(grants, deviceUuid)
            : this.levelVisible(grants, elementId);
    }

    /** May these grants see this object now? For values pushed to a
     * subscription. */
    visibleNow(grants: Grants, elementId: string): boolean {
        if (grants.all) return true;
        const device = this.tree.deviceOf(elementId);
        return device !== null
            ? this.deviceVisible(grants, device)
            : this.levelVisible(grants, elementId);
    }

    private decode(principal: unknown): [string | null, string | null] {
        try {
            return this.auth.decode_principal(principal);
        } catch {
            return [null, null];
        }
    }

    /* The Kerberos-only bypass of service-client's fetch_acl. A Keycloak
     * login is a principal UUID; administrators get the wildcard by
     * grant instead (acs-service-setup/dumps/admin.yaml). */
    private isRoot(type: string, name: string): boolean {
        const root = this.auth.root_principal;
        return !!root && type === "kerberos" && name === root;
    }

    private toGrants(acl: Ace[]): Grants {
        let g = this.fromAcl.get(acl);
        if (g) return g;
        const targets = new Set<string>();
        for (const ace of acl)
            if (ace.permission === Perm.ReadObject) targets.add(ace.target);
        g = targets.has(NULL_UUID) ? ALL_GRANTS : { all: false, targets };
        this.fromAcl.set(acl, g);
        return g;
    }

    private deviceVisible(grants: Grants, device: string): boolean {
        if (grants.targets.has(device)) return true;
        const v = this.view(grants);
        const parent = v.index.placement.deviceParent.get(device);
        return parent !== undefined && v.covered.has(parent);
    }

    private levelVisible(grants: Grants, levelId: string): boolean {
        const v = this.view(grants);
        return v.covered.has(levelId) || v.path.has(levelId);
    }

    private index(): LevelIndex {
        const placement = this.tree.placement();
        const vocabRev = this.vocabulary.revision();
        const old = this.levelIndex;
        if (old && old.placement === placement && old.vocabRev === vocabRev) return old;

        const chains = new Map<string, string[]>();
        const chainOf = (id: string): string[] => {
            let c = chains.get(id);
            if (c) return c;
            const level = placement.levels.get(id);
            if (!level) return [];
            chains.set(id, c = []);   // a parent cycle ends here
            c.push(...chainOf(level.parentId), level.name);
            return c;
        };
        const vocabOf = new Map<string, string | null>();
        for (const id of placement.levels.keys())
            vocabOf.set(id, this.vocabulary.resolve(chainOf(id)));
        return this.levelIndex = { placement, vocabRev, vocabOf };
    }

    private view(grants: Grants): View {
        const index = this.index();
        const old = this.views.get(grants);
        if (old && old.index === index) return old;

        const { levels, deviceParent } = index.placement;
        const { targets } = grants;

        const covered = new Set<string>();
        const under = new Map<string, boolean>();
        const isCovered = (id: string): boolean => {
            const known = under.get(id);
            if (known !== undefined) return known;
            under.set(id, false);   // a parent cycle ends here
            const vocab = index.vocabOf.get(id);
            const level = levels.get(id);
            const yes = (vocab != null && targets.has(vocab))
                || (!!level && isCovered(level.parentId));
            under.set(id, yes);
            return yes;
        };
        for (const id of levels.keys()) if (isCovered(id)) covered.add(id);

        const path = new Set<string>();
        const up = (id: string | undefined) => {
            while (id !== undefined && !path.has(id)) {
                const level = levels.get(id);
                if (!level) return;
                path.add(id);
                id = level.parentId;
            }
        };
        for (const t of targets) up(deviceParent.get(t));
        for (const id of covered) up(id);

        const v = { index, covered, path };
        this.views.set(grants, v);
        return v;
    }
}

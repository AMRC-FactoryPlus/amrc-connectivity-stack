/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Isa95Vocabulary: the ISA-95 vocabulary nodes from ConfigDB, and the
 * match from a device's free-text hierarchy to them.
 *
 * Devices record their hierarchy as names (Enterprise "AMRC", Site
 * "Factory 2050", ...). A ReadObject grant on a vocabulary node covers
 * every device whose hierarchy resolves through that node. A name
 * resolves one level at a time: at the top against the Enterprise
 * nodes, below that against the children of the node matched above,
 * ignoring case, by canonical name or alias. These are the rules the
 * admin UI's vocabulary import uses. A name that does not match ends
 * the match: grants on deeper nodes do not apply.
 */

import * as rx from "rxjs";

import {
    INFO_APP_UUID,
    ISA95_ENTERPRISE_CLASS_UUID,
    ISA95_LEVEL_CLASS_UUID,
    ISA95_VOCABULARY_APP_UUID,
} from "./constants.js";

export interface VocabNode {
    uuid: string;
    name: string;
    aliases: string[];
    /** Child node UUIDs, from the node's vocabulary config. */
    children: string[];
    /** An Enterprise node: the top of a match. */
    root: boolean;
}

interface Isa95VocabularyOpts {
    log?: (msg: string, ...args: any[]) => void;
}

const fold = (s: string) => s.trim().toLowerCase();

export class Isa95Vocabulary {
    private log: (msg: string, ...args: any[]) => void;
    private nodes: Map<string, VocabNode> = new Map();
    private roots: VocabNode[] = [];
    private subscription: rx.Subscription | null = null;
    /* Bumped by every change to the nodes. */
    private changes: number = 0;

    constructor(opts: Isa95VocabularyOpts = {}) {
        this.log = opts.log ?? (() => {});
    }

    /** Changes whenever the vocabulary does. */
    revision(): number {
        return this.changes;
    }

    /** Replace the whole vocabulary. */
    set(nodes: VocabNode[]): void {
        this.nodes = new Map(nodes.map(n => [n.uuid, n]));
        this.roots = nodes.filter(n => n.root);
        this.changes++;
        this.log("vocabulary: %d nodes, %d enterprises", nodes.length, this.roots.length);
    }

    /**
     * The vocabulary node a hierarchy path resolves to, top first, or
     * null when any name on the way does not match.
     */
    resolve(chain: string[]): string | null {
        let scope = this.roots;
        let node: VocabNode | undefined;
        for (const name of chain) {
            const want = fold(name);
            node = scope.find(n => fold(n.name) === want
                || n.aliases.some(a => fold(a) === want));
            if (!node) return null;
            scope = node.children
                .map(c => this.nodes.get(c))
                .filter((c): c is VocabNode => !!c);
        }
        return node?.uuid ?? null;
    }

    /**
     * Follow the vocabulary in ConfigDB: the members of the ISA-95
     * level classes, their vocabulary configs and their names. Until
     * the first full set arrives the vocabulary is empty, so no grant
     * on a node applies.
     */
    run(fplus: any): void {
        const cdb = fplus.ConfigDB;
        this.subscription = rx.combineLatest({
            all: cdb.watch_members(ISA95_LEVEL_CLASS_UUID) as rx.Observable<Iterable<string>>,
            roots: cdb.watch_members(ISA95_ENTERPRISE_CLASS_UUID) as rx.Observable<Iterable<string>>,
            vocab: cdb.search_app(ISA95_VOCABULARY_APP_UUID) as rx.Observable<{ get(k: string): any }>,
        }).pipe(
            rx.switchMap(({ all, roots, vocab }) => {
                const uuids = [...all];
                const top = new Set(roots);
                const names = uuids.length
                    ? rx.combineLatest(uuids.map(u =>
                        (cdb.watch_config(INFO_APP_UUID, u) as rx.Observable<any>)
                            .pipe(rx.startWith(null))))
                    : rx.of([]);
                return names.pipe(rx.map(infos => uuids.map((uuid, i): VocabNode => {
                    const v = vocab.get(uuid) ?? {};
                    return {
                        uuid,
                        name: infos[i]?.name ?? uuid,
                        aliases: Array.isArray(v.aliases) ? v.aliases : [],
                        children: Array.isArray(v.children) ? v.children : [],
                        root: top.has(uuid),
                    };
                })));
            }),
            rx.debounceTime(100),
        ).subscribe({
            next: nodes => this.set(nodes),
            error: err => console.error("Isa95Vocabulary: following ConfigDB failed:", err),
        });
    }

    stop(): void {
        this.subscription?.unsubscribe();
        this.subscription = null;
    }
}

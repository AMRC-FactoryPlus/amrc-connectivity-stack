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
    isa95_chain, isa95_value_problem, isa95_vocabulary,
} from "@amrc-factoryplus/service-client";
import type { Isa95VocabIndex } from "@amrc-factoryplus/service-client";

import {
    INFO_APP_UUID,
    ISA95_ENTERPRISE_CLASS_UUID,
    ISA95_LEVEL_CLASSES,
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
    /** The ISA-95 level (Enterprise, Site, ...), when known. */
    level?: string;
    /** False when the node's name has not been read: `name` is then
     * its UUID, which must not reach a topic. */
    named?: boolean;
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
    private index: Isa95VocabIndex | null = null;
    private listeners: Set<() => void> = new Set();

    constructor(opts: Isa95VocabularyOpts = {}) {
        this.log = opts.log ?? (() => {});
    }

    /** Changes whenever the vocabulary does. */
    revision(): number {
        return this.changes;
    }

    /** Has the vocabulary been read from ConfigDB yet? */
    isReady(): boolean {
        return this.changes > 0;
    }

    /** Call `fn` after every change. Returns a function to stop. */
    onChange(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /** Replace the whole vocabulary. */
    set(nodes: VocabNode[]): void {
        this.nodes = new Map(nodes.map(n => [n.uuid, n]));
        this.roots = nodes.filter(n => n.root);
        this.index = null;
        this.changes++;
        this.log("vocabulary: %d nodes, %d enterprises", nodes.length, this.roots.length);
        for (const fn of this.listeners) fn();
    }

    /**
     * The UNS segments of a placement: the names from its node's
     * Enterprise down to the node, by the shared rule. Null when the
     * placement is missing, its chain is broken, a name is not known
     * yet, or a name cannot go in a topic.
     */
    placementSegments(placement: any): string[] | null {
        const node = placement?.node;
        if (typeof node !== "string") return null;
        this.index ??= isa95_vocabulary([...this.nodes.values()]
            .filter(n => n.named !== false));
        const { chain } = isa95_chain(this.index, node);
        if (!chain) return null;
        const segments = chain.map(n => n.name.trim());
        if (segments.some(s => isa95_value_problem(s))) return null;
        return segments;
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
     * on a node applies. ISA95Level is a class of classes: its members
     * are the level classes (Enterprise, Site, ...), and the nodes are
     * the members of those.
     */
    run(fplus: any): void {
        const cdb = fplus.ConfigDB;
        const levelOf = new Map(Object.entries(ISA95_LEVEL_CLASSES)
            .map(([level, klass]) => [klass, level]));
        this.subscription = rx.combineLatest({
            levels: cdb.watch_member_members(ISA95_LEVEL_CLASS_UUID) as
                rx.Observable<{ entries(): Iterable<[string, Iterable<string>]> }>,
            roots: cdb.watch_members(ISA95_ENTERPRISE_CLASS_UUID) as rx.Observable<Iterable<string>>,
            vocab: cdb.search_app(ISA95_VOCABULARY_APP_UUID) as rx.Observable<{ get(k: string): any }>,
        }).pipe(
            rx.switchMap(({ levels, roots, vocab }) => {
                /* A node's level is the level class it is a member of. */
                const level = new Map<string, string>();
                for (const [klass, members] of levels.entries())
                    for (const m of members)
                        if (levelOf.has(klass)) level.set(m, levelOf.get(klass)!);
                const uuids = [...new Set([...levels.entries()].flatMap(([, ms]) => [...ms]))];
                const top = new Set(roots);
                /* Wait for every name: a name that has not arrived would
                 * otherwise render as a UUID in a device's position. */
                const names = uuids.length
                    ? rx.combineLatest(uuids.map(u =>
                        cdb.watch_config(INFO_APP_UUID, u) as rx.Observable<any>))
                    : rx.of([]);
                return names.pipe(rx.map(infos => uuids.map((uuid, i): VocabNode => {
                    const v = vocab.get(uuid) ?? {};
                    const name = infos[i]?.name;
                    return {
                        uuid,
                        name: typeof name === "string" ? name : uuid,
                        named: typeof name === "string",
                        aliases: Array.isArray(v.aliases) ? v.aliases : [],
                        children: Array.isArray(v.children) ? v.children : [],
                        root: top.has(uuid),
                        level: level.get(uuid),
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

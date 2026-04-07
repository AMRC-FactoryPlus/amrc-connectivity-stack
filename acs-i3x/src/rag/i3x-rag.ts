/*
 * I3xRag — graph + search index for RAG-style queries over the i3X object tree.
 *
 * Mirrors all I3xObjects into a graphology undirected graph (parent-child edges)
 * and a MiniSearch full-text index for fast lookup by displayName / typeElementId.
 */

import Graph from "graphology";
import MiniSearch from "minisearch";
import { bfsFromNode } from "graphology-traversal";
import { bidirectional } from "graphology-shortest-path/unweighted";

import type { I3xObject, I3xVqt } from "../types/i3x.js";

/* ------------------------------------------------------------------ */
/*  Structural interfaces — what I3xRag needs from its dependencies   */
/* ------------------------------------------------------------------ */

/** Minimal interface for what I3xRag needs from ObjectTree. */
export interface ObjectTreeLike {
    getObjects(opts?: any): I3xObject[];
    getObject(elementId: string): I3xObject | undefined;
    getObjectTypes(): Array<{ elementId: string; displayName: string }>;
    getChildElementIds(elementId: string): string[];
    getDescendantLeafIds(elementId: string, maxDepth?: number): string[];
    getRelated(elementId: string): I3xObject[];
}

/** Minimal interface for what I3xRag needs from ValueCache. */
export interface ValueCacheLike {
    getValue(elementId: string): {
        elementId: string;
        isComposition: boolean;
        value: unknown;
        quality: string;
        timestamp: string;
    } | null;
}

/** Minimal interface for what I3xRag needs from History. */
export interface HistoryLike {
    queryHistory(
        elementId: string,
        startTime: string,
        endTime: string,
    ): Promise<I3xVqt[]>;
}

/* ------------------------------------------------------------------ */
/*  Node attributes stored on each graphology node                    */
/* ------------------------------------------------------------------ */

interface NodeAttributes {
    displayName: string;
    typeElementId: string;
    isComposition: boolean;
    parentId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Search result types                                               */
/* ------------------------------------------------------------------ */

export interface SearchResult {
    elementId: string;
    displayName: string;
    typeElementId: string;
    score: number;
}

export interface SearchRelatedResult extends SearchResult {
    related: Array<{ elementId: string; displayName: string; depth: number }>;
}

export interface TraversalNode {
    elementId: string;
    displayName: string;
    depth: number;
}

export interface CompositionTreeNode {
    elementId: string;
    displayName: string;
    typeElementId: string;
    isComposition: boolean;
    children: CompositionTreeNode[];
}

/* ------------------------------------------------------------------ */
/*  I3xRag                                                            */
/* ------------------------------------------------------------------ */

export class I3xRag {
    private readonly objectTree: ObjectTreeLike;
    private readonly valueCache: ValueCacheLike;
    private readonly history: HistoryLike;

    private graph: Graph<NodeAttributes>;
    private index: MiniSearch<I3xObject>;

    constructor(
        objectTree: ObjectTreeLike,
        valueCache: ValueCacheLike,
        history: HistoryLike,
    ) {
        this.objectTree = objectTree;
        this.valueCache = valueCache;
        this.history = history;
        this.graph = new Graph({ type: "undirected" });
        this.index = this.createIndex();
    }

    /* -- lifecycle ------------------------------------------------- */

    /** Populate the graph and search index from the current object tree. */
    init(): void {
        this.populate();
    }

    /** Clear both graph and search index, then re-populate from scratch. */
    rebuild(): void {
        this.graph.clear();
        this.index = this.createIndex();
        this.populate();
    }

    /* -- accessors ------------------------------------------------- */

    nodeCount(): number {
        return this.graph.order;
    }

    edgeCount(): number {
        return this.graph.size;
    }

    /* -- search --------------------------------------------------- */

    /** Full-text search across displayName and typeElementId. */
    search(query: string, limit: number = 20): SearchResult[] {
        const raw = this.index.search(query, { prefix: true, fuzzy: 0.2 });
        return raw.slice(0, limit).map(r => ({
            elementId: r.id as string,
            displayName: r.displayName as string,
            typeElementId: r.typeElementId as string,
            score: r.score,
        }));
    }

    /** Search filtered to a specific typeElementId. */
    searchByType(typeElementId: string, query: string, limit: number = 20): SearchResult[] {
        const raw = this.index.search(query, {
            prefix: true,
            fuzzy: 0.2,
            filter: (result) => result.typeElementId === typeElementId,
        });
        return raw.slice(0, limit).map(r => ({
            elementId: r.id as string,
            displayName: r.displayName as string,
            typeElementId: r.typeElementId as string,
            score: r.score,
        }));
    }

    /** Search with related neighbours attached to each result. */
    searchRelated(query: string, hops: number = 1, limit: number = 20): SearchRelatedResult[] {
        const results = this.search(query, limit);
        return results.map(r => ({
            ...r,
            related: this.neighborhood(r.elementId, hops),
        }));
    }

    /* -- graph traversal ------------------------------------------- */

    /** BFS from a node, collecting visited nodes up to N hops. Does NOT include the source. */
    traverse(elementId: string, hops: number = 1): TraversalNode[] {
        if (!this.graph.hasNode(elementId)) return [];

        const result: TraversalNode[] = [];
        bfsFromNode(this.graph, elementId, (node, attrs, depth) => {
            if (depth > hops) return true;       // stop traversal
            if (depth > 0) {                      // skip source node
                result.push({
                    elementId: node,
                    displayName: attrs.displayName,
                    depth,
                });
            }
        });
        return result;
    }

    /** Return neighbours within `hops` of a node. Delegates to traverse(). */
    neighborhood(elementId: string, hops: number = 2): TraversalNode[] {
        return this.traverse(elementId, hops);
    }

    /** Shortest path between two nodes. Returns null if either doesn't exist or no path. */
    findPath(fromId: string, toId: string): string[] | null {
        if (!this.graph.hasNode(fromId) || !this.graph.hasNode(toId)) return null;
        if (fromId === toId) return [fromId];
        return bidirectional(this.graph, fromId, toId);
    }

    /** Build a nested composition tree starting from a node. */
    compositionTree(elementId: string, maxDepth: number = 0): CompositionTreeNode | null {
        if (!this.graph.hasNode(elementId)) return null;
        return this.buildCompositionNode(elementId, 0, maxDepth);
    }

    /* -- internals ------------------------------------------------- */

    private buildCompositionNode(
        elementId: string,
        currentDepth: number,
        maxDepth: number,
    ): CompositionTreeNode {
        const attrs = this.graph.getNodeAttributes(elementId);
        const childIds = this.objectTree.getChildElementIds(elementId);

        let children: CompositionTreeNode[] = [];
        if (maxDepth === 0 || currentDepth < maxDepth) {
            children = childIds.map(cid =>
                this.buildCompositionNode(cid, currentDepth + 1, maxDepth),
            );
        }

        return {
            elementId,
            displayName: attrs.displayName,
            typeElementId: attrs.typeElementId,
            isComposition: attrs.isComposition,
            children,
        };
    }

    private createIndex(): MiniSearch<I3xObject> {
        return new MiniSearch<I3xObject>({
            fields: ["displayName", "typeElementId"],
            storeFields: ["displayName", "typeElementId", "parentId", "isComposition"],
            idField: "elementId",
        });
    }

    private populate(): void {
        const objects = this.objectTree.getObjects();

        /* Add nodes */
        for (const obj of objects) {
            this.graph.addNode(obj.elementId, {
                displayName: obj.displayName,
                typeElementId: obj.typeElementId,
                isComposition: obj.isComposition,
                parentId: obj.parentId,
            });
        }

        /* Add parent-child edges */
        for (const obj of objects) {
            if (obj.parentId != null && obj.parentId !== "/") {
                if (this.graph.hasNode(obj.parentId)) {
                    this.graph.addEdge(obj.parentId, obj.elementId, {
                        label: "parent-child",
                    });
                }
            }
        }

        /* Build search index */
        this.index.addAll(objects);
    }
}

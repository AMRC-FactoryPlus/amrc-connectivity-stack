/*
 * ACS Data Access Service
 * The parts of every dataset, kept up to date one change at a time
 * Copyright 2026 University of Sheffield
 */

/* Nothing here uses rxjs. PartsIndex takes one change at a time
 * through `apply` and says which datasets that change touched, so the
 * caller can update what it derives from the map without reading the
 * whole map again. `apply` returns null when the change made no
 * difference. */

import { Map as IMap, Set as ISet, is as imm_is } from "immutable";

/** The parts of every Dataset member.
 *
 * A dataset's parts are its subclasses that are themselves Dataset
 * members. Feed this the values of `watch_each` over the Dataset
 * member Set, with `ConfigDB#watch_subclasses` as the inner sequence.
 * The result is a Map from member UUID to the Set of its parts, with
 * one entry for every member.
 *
 * A member that joins or leaves touches its own entry and the entries
 * of the datasets that list it as a subclass, and no other. A new
 * subclass list touches the entry of that one dataset.
 *
 * A result also gives `parents`: for a part, the datasets that list
 * it. A reader uses it to find the datasets to look at again when
 * something about a part changes, such as who may read it. It always
 * covers the map of the last result, so that reader never misses a
 * dataset. See the field below for what else it can hold.
 */
export class PartsIndex {
    constructor () {
        /* The Dataset members, or null before the first Set. */
        this.members = null;
        /* Member UUID -> the Set of all its subclasses, as ConfigDB
         * gave it, for each member that has answered. */
        this.raw = new Map();
        /** Subclass UUID -> the native Set of members that list it.
         *
         * This comes from the whole subclass lists, so it knows a part
         * before that part is a Dataset member. It is this index's own
         * Map, changed in place: read it, do not change it.
         *
         * A reader holds the map of the last result and this Map
         * together, also while the index waits for a new member to
         * answer, which can be a long time when many datasets are
         * made at once. So a link the last result's map shows must
         * stay here until the result that takes it out of the map. A
         * new link goes in at once and a link that is gone comes out
         * with the next result. Between results this Map can hold
         * links that are gone, and never lacks one the reader's map
         * has: the reader may look at a dataset it did not need to,
         * and cannot miss one. */
        this.parents = new Map();
        /* The links to take out of `parents` with the next result:
         * subclass UUID -> the native Set of members that listed it. */
        this.unlinked = new Map();
        /** Member UUID -> Set of the subclasses that are members. */
        this.map = IMap();
        /* The members whose entry changed since the last result, and
         * the map that result gave. */
        this.pending = new Set();
        this.sent = this.map;
        this.started = false;
    }

    /** Apply one value of the `watch_each` sequence.
     *
     * @arg event `{ set, added, removed }` when the Dataset members
     * are given, or `{ key, value }` with a member UUID and its
     * subclass Set.
     * @returns `{ map, changed, parents }`, or null if nothing differs
     * or not every member has answered yet. `changed` is a native Set
     * of member UUIDs. It is null on the first result, where every key
     * counts as changed.
     */
    apply (event) {
        if (event.set !== undefined)
            this._apply_set(event);
        else
            this._apply_member(event.key, event.value);
        return this._flush();
    }

    _apply_set ({ set, added, removed }) {
        if (this.members == null) {
            this.members = new Set(set);
            return;
        }

        for (const member of removed ?? []) {
            if (!this.members.delete(member)) continue;
            this._link(member, this.raw.get(member), null);
            this.raw.delete(member);
            if (this.map.has(member)) {
                this.map = this.map.delete(member);
                this.pending.add(member);
            }
            this._refresh_parents_of(member);
        }
        for (const member of added ?? []) {
            if (this.members.has(member)) continue;
            this.members.add(member);
            this._refresh_parents_of(member);
        }
    }

    _apply_member (member, subs) {
        if (!this.members?.has(member)) return;
        const next = ISet(subs);
        this._link(member, this.raw.get(member), next);
        this.raw.set(member, next);
        this._refresh(member);
    }

    /* Move a member's links in `parents` from its old subclass Set to
     * its new one. Either can be missing. A new link goes in now. A
     * link that is gone is only noted: `_unlink` takes it out. */
    _link (member, before, after) {
        if (before) {
            for (const part of before) {
                if (after?.has(part)) continue;
                let gone = this.unlinked.get(part);
                if (!gone) this.unlinked.set(part, gone = new Set());
                gone.add(member);
            }
        }
        if (after) {
            for (const part of after) {
                if (before?.has(part)) continue;
                let listed = this.parents.get(part);
                if (!listed) this.parents.set(part, listed = new Set());
                listed.add(member);
            }
        }
    }

    /* Take the noted links out of `parents`. Call this only when the
     * map is the one the reader holds or is about to get. A link that
     * came back since it was noted is in the member's subclass Set
     * again, and stays. */
    _unlink () {
        for (const [part, gone] of this.unlinked) {
            const listed = this.parents.get(part);
            if (!listed) continue;
            for (const member of gone)
                if (!this.raw.get(member)?.has(part)) listed.delete(member);
            if (listed.size == 0) this.parents.delete(part);
        }
        this.unlinked.clear();
    }

    /* Work out one member's entry again. The entry is always the
     * member's whole subclass Set filtered, never the old entry with
     * one part added or removed, so the parts keep the order ConfigDB
     * listed them in. */
    _refresh (member) {
        const raw = this.raw.get(member);
        if (raw === undefined) return;
        const parts = raw.filter(part => this.members.has(part));
        const held = this.map.get(member);
        if (held !== undefined && imm_is(held, parts)) return;
        this.map = this.map.set(member, parts);
        this.pending.add(member);
    }

    /* A UUID has joined or left the members. The datasets that list it
     * as a subclass gain or lose it as a part. `parents` can name a
     * dataset that no longer lists it; `_refresh` then finds nothing
     * to change. */
    _refresh_parents_of (part) {
        const listed = this.parents.get(part);
        if (!listed) return;
        for (const member of listed) this._refresh(member);
    }

    /* `raw` holds an entry for each member that has answered and for
     * nothing else, so the sizes agree when every member has. */
    _ready () {
        return this.members != null && this.raw.size == this.members.size;
    }

    _flush () {
        if (!this._ready()) return null;

        /* Every path below leaves the reader with the map as it is
         * now: a result gives it, and with no result the map is back
         * to the last one given. So `parents` can lose the links that
         * map does not have. */
        this._unlink();

        const { parents } = this;
        if (!this.started) {
            this.started = true;
            this.pending = new Set();
            this.sent = this.map;
            return { map: this.map, changed: null, parents };
        }

        /* While a new member had not answered, an entry can have
         * changed and changed back. Report only what differs from the
         * last result, and keep the old Set where nothing does. */
        const changed = new Set();
        for (const member of this.pending) {
            const before = this.sent.get(member);
            const now = this.map.get(member);
            if (before === now) continue;
            if (before !== undefined && now !== undefined
                && imm_is(before, now))
                this.map = this.map.set(member, before);
            else
                changed.add(member);
        }
        this.pending = new Set();
        if (changed.size == 0) {
            this.map = this.sent;
            return null;
        }
        this.sent = this.map;
        return { map: this.map, changed, parents };
    }
}

/*
 * ACS Admin
 * Pinia store for ISA-95 vocabulary — enterprises, sites, areas, etc.
 * Copyright 2026 University of Sheffield AMRC
 */

import { defineStore } from 'pinia'
import * as rx          from 'rxjs'
import * as rxu         from '@amrc-factoryplus/rx-util'
import { UUIDs }        from '@amrc-factoryplus/service-client'

import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { serviceClientReady }    from '@store/useServiceClientReady.js'

/* The Device Information schema key holding the ISA-95 level metrics. These
 * are a controlled vocabulary: they are written only via ISA95HierarchyPanel,
 * never by free-text entry. */
export const ISA95_HIERARCHY_KEY = 'ISA95_Hierarchy'

/* Ordered list of ISA-95 levels, matching the metric key names used in the
 * Device Information schema (spaces included). */
export const ISA95_LEVELS = [
    'Enterprise',
    'Site',
    'Area',
    'Work Center',
    'Work Unit',
]

/* ConfigDB class holding the nodes at each level. */
export const ISA95_LEVEL_CLASSES = {
    'Enterprise':  UUIDs.Class.ISA95Enterprise,
    'Site':        UUIDs.Class.ISA95Site,
    'Area':        UUIDs.Class.ISA95Area,
    'Work Center': UUIDs.Class.ISA95WorkCenter,
    'Work Unit':   UUIDs.Class.ISA95WorkUnit,
}

export const useISA95Store = defineStore('isa95', {
    state: () => ({
        data:   [],
        ready:  false,
        rxsub:  null,
    }),

    getters: {
        /* All enterprise-level nodes. */
        enterprises: (state) => state.data.filter(n => n.level === 'Enterprise'),

        /* Look up a single node by UUID. */
        by_uuid: (state) => (uuid) => state.data.find(n => n.uuid === uuid),

        /* Children of a given node UUID, resolved to full node objects. */
        children_of: (state) => (uuid) => {
            const node = state.data.find(n => n.uuid === uuid)
            if (!node) return []
            return node.children
                .map(child_uuid => state.data.find(n => n.uuid === child_uuid))
                .filter(Boolean)
        },

        /* Nodes whose children list includes the given UUID. */
        parents_of: (state) => (uuid) =>
            state.data.filter(n => n.children.includes(uuid)),

        /* Find a node at a given level by its canonical name or an alias. */
        find_by_name: (state) => (level, name) =>
            state.data.find(n =>
                n.level === level &&
                (n.name === name || n.aliases.includes(name))
            ),
    },

    actions: {
        async start () {
            if (this.rxsub) return

            await serviceClientReady()
            const cdb = useServiceClientStore().client.ConfigDB

            const member_obs = Object.fromEntries(
                Object.entries(ISA95_LEVEL_CLASSES).map(([level, class_uuid]) => [
                    level,
                    cdb.watch_members(class_uuid),
                ])
            )

            const vocab = cdb.search_app(UUIDs.App.ISA95Vocabulary)
            const info  = cdb.search_app(UUIDs.App.Info)

            this.rxsub = rxu.rx(
                rx.combineLatest({ ...member_obs, vocab, info }),
                rx.map(({ vocab, info, ...members_by_level }) => {
                    const nodes = []
                    for (const [level, uuids] of Object.entries(members_by_level)) {
                        for (const uuid of uuids) {
                            const v = vocab.get(uuid) ?? {}
                            const i = info.get(uuid)  ?? {}
                            nodes.push({
                                uuid,
                                name:     i.name    ?? uuid,
                                aliases:  v.aliases ?? [],
                                children: v.children ?? [],
                                level,
                            })
                        }
                    }
                    return nodes
                }),
                rx.share(),
            ).subscribe(nodes => {
                this.data  = nodes
                this.ready = true
            })
        },

        stop () {
            this.rxsub?.unsubscribe()
            this.rxsub = null
            this.ready = false
        },
    },
})

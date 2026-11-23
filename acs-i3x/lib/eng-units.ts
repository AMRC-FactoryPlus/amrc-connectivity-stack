/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * EngUnits: the engineering unit vocabulary from ConfigDB, and the
 * UNECE code a metric's Eng_Unit string resolves to.
 *
 * Metrics keep the Eng_Unit string they were configured with; the
 * historians tag their series with it. The vocabulary says which unit
 * each string means: a unit's symbol or one of its aliases. i3X returns
 * the unit's UNECE Recommendation 20 code as an object's
 * metadata.engUnit, as the i3X specification requires, and only when
 * the string resolves.
 */

import * as rx from "rxjs";

import { eng_unit_resolver } from "@amrc-factoryplus/service-client";

import { ENGINEERING_UNIT_APP_UUID } from "./constants.js";

/** What the object tree needs to describe a metric's unit. */
export interface UnitSource {
    /** The UNECE code an Eng_Unit string means, or undefined. */
    code(unit: string): string | undefined;
    /** Changes whenever the vocabulary does. */
    revision(): number;
}

interface EngUnitsOpts {
    log?: (msg: string, ...args: any[]) => void;
}

export class EngUnits implements UnitSource {
    private log: (msg: string, ...args: any[]) => void;
    private resolve: (unit: unknown) => { code: string } | undefined = () => undefined;
    private changes: number = 0;
    private subscription: rx.Subscription | null = null;

    constructor(opts: EngUnitsOpts = {}) {
        this.log = opts.log ?? (() => {});
    }

    revision(): number {
        return this.changes;
    }

    /** Has the vocabulary been read from ConfigDB yet? */
    isReady(): boolean {
        return this.changes > 0;
    }

    code(unit: string): string | undefined {
        const code = this.resolve(unit)?.code;
        return typeof code === "string" ? code : undefined;
    }

    /** Replace every unit: the EngineeringUnit configs. */
    set(units: Iterable<any>): void {
        const valid = [...units].filter(u => u && typeof u.symbol === "string");
        this.resolve = eng_unit_resolver(valid);
        this.changes++;
        this.log("engineering units: %d", valid.length);
    }

    /** Follow the Engineering unit app in ConfigDB. */
    run(fplus: any): this {
        this.subscription = (fplus.ConfigDB.search_app(ENGINEERING_UNIT_APP_UUID) as
            rx.Observable<{ entries(): Iterable<[string, any]> }>)
            .pipe(rx.retry({
                delay: (err: unknown) => {
                    console.error("EngUnits: following ConfigDB failed, retrying:", err);
                    return rx.timer(10_000);
                },
            }))
            .subscribe(m => this.set([...m.entries()].map(([, unit]) => unit)));
        return this;
    }

    stop(): void {
        this.subscription?.unsubscribe();
        this.subscription = null;
    }
}

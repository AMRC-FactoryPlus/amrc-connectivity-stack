#!/usr/bin/env node
/*
 * ACS simulator driver
 * Generate a CNC machining-cycle cassette from an origin map CSV.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Usage: node tools/generate-cnc-cassette.js origin-map.csv > out.json
 *
 * Builds a deterministic five-minute, 1 Hz cassette covering every tag
 * in the origin map: a 3-axis milling cycle with tool change, roughing
 * and finishing phases. Static tags are asserted once at offset 0;
 * continuous tags are sampled every second; slow tags (states, program
 * info) are sampled on change. Deterministic: the same CSV always
 * produces the same cassette (seeded PRNG, no wall clock).
 */

import fsp from "fs/promises";

const DURATION_S = 300;

/* The cycle, as [start_s, name]. */
const PHASES = [
    [0,   "idle"],
    [8,   "toolchange"],
    [20,  "approach"],
    [30,  "rough"],
    [150, "reposition"],
    [162, "finish"],
    [268, "retract"],
    [280, "end"],
    [288, "idle2"],
];
const phaseAt = t => {
    let p = PHASES[0][1];
    for (const [start, name] of PHASES)
        if (t >= start) p = name;
    return p;
};
const CUTTING = new Set(["rough", "finish"]);
const MOVING = new Set(["approach", "rough", "reposition", "finish", "retract"]);

/* mulberry32: tiny deterministic PRNG. */
function prng (seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const r3 = v => Math.round(v * 1000) / 1000;

async function readOriginMap (file) {
    const text = await fsp.readFile(file, "utf-8");
    const rows = text.split("\n")
        .map(l => l.replace(/\r$/, ""))
        .filter(l => l.length)
        .map(l => l.split(","));
    /* Data rows carry the schema type in the last column; the legend
     * block at the bottom of the sheet doesn't. */
    return rows.slice(1)
        .filter(r => r.length >= 12 && /\w+\/\w+/.test(r[11]))
        .map(r => ({ path: r[0], type: r[1], engUnit: r[6] || undefined }));
}

/* Classify a tag path into a synthesis rule. Order matters: first
 * match wins. Each rule returns the value at second t, or undefined
 * for "no sample this tick". `slow` rules are only emitted on change. */
function ruleFor (path, rnd) {
    const noise = amp => (rnd() - 0.5) * 2 * amp;
    const axis = path.match(/^Axes\/([XYZ])\//)?.[1];
    const axisPhase = { X: 0, Y: 2.1, Z: 4.2 }[axis] ?? 0;

    /* Axis position profiles, mm. X sweeps, Y steps over per pass,
     * Z sits at cutting depth. */
    const position = t => {
        const p = phaseAt(t);
        if (!MOVING.has(p)) return { X: 0, Y: 0, Z: 150 }[axis];
        if (axis == "X") {
            if (p == "rough") return 100 + 90 * Math.sin(2 * Math.PI * (t - 30) / 24);
            if (p == "finish") return 100 + 90 * Math.sin(2 * Math.PI * (t - 162) / 40);
            return 100;
        }
        if (axis == "Y") {
            if (p == "rough") return 10 + 10 * Math.floor((t - 30) / 24);
            if (p == "finish") return 10 + 22 * Math.floor((t - 162) / 40);
            return 10;
        }
        /* Z: plunge to depth per phase */
        if (p == "rough") return 42 - 3 * Math.floor((t - 30) / 60);
        if (p == "finish") return 35.2;
        if (p == "retract") return 150;
        return 60;
    };
    const feed = t => CUTTING.has(phaseAt(t))
        ? (phaseAt(t) == "rough" ? 1200 : 800) : (MOVING.has(phaseAt(t)) ? 5000 : 0);
    const load = t => CUTTING.has(phaseAt(t))
        ? (phaseAt(t) == "rough" ? 55 : 30) + 8 * Math.sin(t / 3 + axisPhase) + noise(4)
        : (MOVING.has(phaseAt(t)) ? 8 + noise(2) : 2 + noise(0.5));
    const spindleSpeed = t => {
        const p = phaseAt(t);
        if (p == "rough") return 8000 + noise(15);
        if (p == "finish") return 12000 + noise(10);
        if (p == "approach" || p == "reposition") return 8000 + noise(20);
        if (p == "retract") return Math.max(0, 8000 - 600 * (t - 268));
        return 0;
    };
    const activePower = t => CUTTING.has(phaseAt(t))
        ? 6.5 + load(t) / 12 + noise(0.3)
        : (MOVING.has(phaseAt(t)) ? 2.2 + noise(0.2) : 0.8 + noise(0.05));

    /* --- Static: assert once at offset 0. --- */
    const statics = {
        "Model": "XYZ 750LR", "Serial": "750LR-0421", "Variant": "LR",
        "Manufacturer": "XYZ Machine Tools",
        "Friendly_Name": "Demo CNC 1",
        "Software_Version": "v11.2.4",
        "MAC_Address": "00:1b:63:84:45:e6",
        "ISA95_Hierarchy/Enterprise": "AMRC",
        "ISA95_Hierarchy/Site": "Factory 2050",
        "ISA95_Hierarchy/Area": "Machining",
        "ISA95_Hierarchy/Work Center": "CNC Cell",
        "ISA95_Hierarchy/Work Unit": "Demo CNC 1",
        "File_Name": "O1234_BRACKET_OP10.nc",
        "File_Directory_Name": "/programs/demo",
        "CNC_Alarm": "", "CNC_Message": "",
        "Battery/Percentage": 100, "Battery/Time_Remaining": 480,
        "Axis_Type": "LINEAR", "Axis_Coord_System": "MCS",
        "Act_Channel": "C1", "Channel_ID": "C1",
        "Is_Virtual": false, "Is_Inactive": false, "Locked": false,
        "Zero_Offset": 0, "Dry_Run_Feed": 0, "Act_Jog_Increment": 0.01,
        "Block_Mode": "AUTO",
        "Tool_Offset": 0, "Tool_Radius": 5,
        "CmdGear": 1, "Act_Gear": 1,
    };
    for (const [suffix, value] of Object.entries(statics))
        if (path.endsWith("/" + suffix))
            return { static: value };

    /* --- Slow: sampled on change. --- */
    if (path.endsWith("/Status") && path.startsWith("Device_Information"))
        return { slow: () => "OK" };
    if (/Act_Status$|Act_Program_Status$|Base_Axis\/Status$/.test(path))
        return { slow: t => {
            const p = phaseAt(t);
            if (p.startsWith("idle")) return "Idle";
            if (p == "toolchange") return "Tool Change";
            if (p == "end") return "Program End";
            return "Running";
        } };
    if (path.endsWith("Act_Operation_Mode"))
        return { slow: t => phaseAt(t).startsWith("idle") ? "JOG" : "AUTO" };
    if (path.endsWith("Tool_ID"))
        return { slow: t => t < 14 ? "T01" : (phaseAt(t) == "finish" || t >= 160 ? "T05" : "T03") };
    if (path.endsWith("Feed_Hold"))
        return { slow: () => false };
    if (path.endsWith("Message"))
        return { slow: t => phaseAt(t) == "end" ? "Cycle complete" : "" };
    if (/Act_(Main_)?Program_Name$/.test(path))
        return { slow: t => t < 8 ? "" : "O1234_BRACKET_OP10" };
    if (/Act_(Main_)?Program_File$/.test(path))
        return { slow: t => t < 8 ? "" : "/programs/demo/O1234_BRACKET_OP10.nc" };
    if (/Act_(Main_)?Program_(File_Offset|Block)$/.test(path))
        return { slow: t => Math.max(0, Math.floor((t - 20) * 2)) };
    if (/Act_(Main_)?Program_Line$/.test(path))
        return { slow: t => Math.max(0, Math.floor((t - 20) * 2)) };
    if (path.endsWith("Act_G_Function"))
        return { slow: t => {
            const p = phaseAt(t);
            if (p == "rough" || p == "finish") return "G01";
            if (MOVING.has(p)) return "G00";
            return "";
        } };
    if (path.endsWith("Act_M_Function"))
        return { slow: t => {
            const p = phaseAt(t);
            if (p == "toolchange") return "M06";
            if (CUTTING.has(p)) return "M03 M08";
            if (p == "end") return "M30";
            return "";
        } };
    if (path.endsWith("Act_Modal_Offset_Function"))
        return { slow: t => t < 20 ? "G54" : "G54" };
    if (path.endsWith("Act_Program_Workpiece_Count"))
        return { slow: t => t < 282 ? 128 : 129 };
    if (path.endsWith("Act_Turn_Direction"))
        return { slow: t => spindleSpeed(t) > 0 ? "CW" : "NONE" };
    if (path.endsWith("Block_Time"))
        return { slow: t => CUTTING.has(phaseAt(t)) ? r3(0.5 + noise(0.2)) : 0 };
    if (path.endsWith("Act_Override") || path.endsWith("Cmd_Override")
            || path.endsWith("CmdOverride"))
        return { slow: () => 100 };

    /* --- Continuous: sampled every second. --- */
    if (path.endsWith("Operating_Time"))
        return { cont: t => 743520 + t };
    if (path.endsWith("Cutting_Time"))
        return { cont: t => 421080 + Math.floor(Math.min(t, 268) * 0.7) };
    if (path.endsWith("Act_Program_Cycle_Time"))
        return { cont: t => Math.max(0, t - 8) };

    /* Power monitoring blocks (axes and spindle). */
    if (path.includes("Power_Monitoring/")) {
        const scale = path.startsWith("Spindles") ? 1 : 0.25;
        if (path.endsWith("Frequency")) return { cont: () => r3(50 + noise(0.05)) };
        if (path.endsWith("Voltage_AC")) return { cont: () => r3(400 + noise(2)) };
        if (path.endsWith("Current_AC")) return { cont: t => r3(scale * activePower(t) * 2.5) };
        if (path.endsWith("Active_Power")) return { cont: t => r3(scale * activePower(t)) };
        if (path.endsWith("Power_Factor")) return { cont: t => r3(Math.min(0.95, 0.6 + activePower(t) / 30)) };
        if (path.endsWith("Apparent_Power")) return { cont: t => r3(scale * activePower(t) / 0.82) };
        if (path.endsWith("Reactive_Power")) return { cont: t => r3(scale * activePower(t) * 0.4) };
        if (path.endsWith("Active_Energy")) return { cont: t => r3(15230 + scale * t * 0.002) };
        if (path.endsWith("Apparent_Energy")) return { cont: t => r3(18600 + scale * t * 0.0024) };
        if (path.endsWith("Reactive_Energy")) return { cont: t => r3(6090 + scale * t * 0.0008) };
        if (path.endsWith("Energy_Returned")) return { static: 0 };
    }

    /* Temperatures drift up while cutting. */
    if (path.endsWith("Temperature/Set_Point")) return { static: 22 };
    if (path.endsWith("Temperature/Temperature"))
        return { cont: t => r3(24 + Math.min(t, 268) / 60 + noise(0.15)) };
    if (path.endsWith("/Uptime"))
        return { cont: t => 1843200 + t };

    /* Spindle. */
    if (path.startsWith("Spindles/")) {
        if (path.endsWith("Act_Speed")) return { cont: t => r3(spindleSpeed(t)) };
        if (path.endsWith("CmdSpeed")) return { slow: t => {
            const p = phaseAt(t);
            if (p == "finish") return 12000;
            if (MOVING.has(p)) return 8000;
            return 0;
        } };
        if (path.endsWith("Act_Load")) return { cont: t => r3(load(t)) };
        if (path.endsWith("Act_Power")) return { cont: t => r3(activePower(t)) };
        if (path.endsWith("Act_Torque")) return { cont: t => r3(load(t) * 0.4) };
        if (path.endsWith("Cmd_Torque")) return { slow: t => CUTTING.has(phaseAt(t)) ? 25 : 0 };
        if (/Angle_Pos\/Actual$/.test(path)) return { cont: t => r3((t * spindleSpeed(t) * 6) % 360) };
        if (/Angle_Pos\/(Commanded|Remaining)$/.test(path)) return { static: 0 };
        if (/Feedrate\/Actual$/.test(path)) return { cont: t => r3(feed(t) + noise(5)) };
        if (/Feedrate\/Commanded$/.test(path)) return { slow: t => feed(t) };
        if (/Feedrate\/Remaining$/.test(path)) return { static: 0 };
    }

    /* Axis groups. */
    if (axis) {
        if (/Position(_Indirect)?\/Actual$/.test(path)) return { cont: t => r3(position(t) + noise(0.002)) };
        if (/Position(_Indirect)?\/Commanded$/.test(path)) return { cont: t => r3(position(t + 1)) };
        if (/Position(_Indirect)?\/Remaining$/.test(path)) return { cont: t => r3(Math.abs(position(t + 1) - position(t))) };
        if (/Angle\/Actual$/.test(path)) return { static: 0 };
        if (/Angle\/(Commanded|Remaining)$/.test(path)) return { static: 0 };
        if (/Speed\/Actual$/.test(path)) return { cont: t => r3(Math.abs(position(t + 1) - position(t)) * 60 + noise(1)) };
        if (/Speed\/Commanded$/.test(path)) return { slow: t => MOVING.has(phaseAt(t)) ? 5000 : 0 };
        if (/Speed\/Remaining$/.test(path)) return { static: 0 };
        if (/Feedrate\/Actual$/.test(path)) return { cont: t => r3(feed(t) + noise(5)) };
        if (/Feedrate\/Commanded$/.test(path)) return { slow: t => feed(t) };
        if (/Feedrate\/Remaining$/.test(path)) return { static: 0 };
        if (/Torque\/Actual$/.test(path)) return { cont: t => r3(load(t) * 0.25) };
        if (/Torque\/Commanded$/.test(path)) return { slow: t => CUTTING.has(phaseAt(t)) ? 15 : 0 };
        if (/Torque\/Remaining$/.test(path)) return { static: 0 };
        if (/Acceleration\/Actual$/.test(path)) return { cont: t => r3(position(t + 1) - 2 * position(t) + position(Math.max(0, t - 1))) };
        if (/Acceleration\/(Commanded|Remaining)$/.test(path)) return { static: 0 };
        if (path.endsWith("/Load")) return { cont: t => r3(load(t)) };
        if (path.endsWith("/Power")) return { cont: t => r3(activePower(t) * 0.25) };
    }

    /* Channel TCP positions mirror the axis positions. */
    const tcp = path.match(/Pos_TCP_(BCS|WCS)_([XYZABC])\/(Actual|Commanded|Remaining)$/);
    if (tcp) {
        const [, cs, ax, kind] = tcp;
        if ("ABC".includes(ax)) return { static: 0 };
        const off = cs == "WCS" ? 0 : { X: 250, Y: 180, Z: 120 }[ax];
        const pos = t => ruleForAxisPosition(ax, t) + off;
        if (kind == "Actual") return { cont: t => r3(pos(t) + noise(0.002)) };
        if (kind == "Commanded") return { cont: t => r3(pos(t + 1)) };
        return { cont: t => r3(Math.abs(pos(t + 1) - pos(t))) };
    }

    /* Anything the rules don't recognise is asserted once as a
     * type-appropriate default so the cassette still covers it. */
    return { unknown: true };
}

/* Axis position, standalone for the TCP mirror channels. */
function ruleForAxisPosition (axis, t) {
    const p = phaseAt(t);
    if (!MOVING.has(p)) return { X: 0, Y: 0, Z: 150 }[axis];
    if (axis == "X") {
        if (p == "rough") return 100 + 90 * Math.sin(2 * Math.PI * (t - 30) / 24);
        if (p == "finish") return 100 + 90 * Math.sin(2 * Math.PI * (t - 162) / 40);
        return 100;
    }
    if (axis == "Y") {
        if (p == "rough") return 10 + 10 * Math.floor((t - 30) / 24);
        if (p == "finish") return 10 + 22 * Math.floor((t - 162) / 40);
        return 10;
    }
    if (p == "rough") return 42 - 3 * Math.floor((t - 30) / 60);
    if (p == "finish") return 35.2;
    if (p == "retract") return 150;
    return 60;
}

function defaultFor (type) {
    if (type == "String") return "";
    if (type == "Boolean") return false;
    return 0;
}

async function main () {
    const file = process.argv[2];
    if (!file) {
        console.error("usage: generate-cnc-cassette.js origin-map.csv > out.json");
        process.exit(1);
    }

    const tags = await readOriginMap(file);
    const rnd = prng(0x5EED);

    const channels = tags.map((t, i) => ({
        id: i, path: t.path, type: t.type,
        ...(t.engUnit ? { engUnit: t.engUnit } : {}),
    }));

    const rules = tags.map(t => ruleFor(t.path, rnd));
    const samples = [];
    const lastValue = new Map();

    for (let t = 0; t <= DURATION_S; t++) {
        const off = t * 1000;
        rules.forEach((rule, i) => {
            let v;
            if (t == 0) {
                v = rule.static ?? (rule.slow?.(0) ?? rule.cont?.(0)
                    ?? defaultFor(tags[i].type));
            }
            else if (rule.cont) v = rule.cont(t);
            else if (rule.slow) {
                const nv = rule.slow(t);
                if (nv === lastValue.get(i)) return;
                v = nv;
            }
            else return;    /* static/unknown: offset 0 only */

            if (rule.slow || rule.static !== undefined || rule.unknown)
                lastValue.set(i, v);
            samples.push([off, i, v]);
        });
    }

    const doc = {
        cassette: {
            name: "cnc-op10-bracket-rough-and-finish",
            version: 1,
            description: "Five-minute 3-axis CNC milling cycle at 1 Hz: "
                + "tool change, roughing and finishing passes on a demo "
                + "bracket. Generated deterministically from the CNC "
                + "origin map.",
            deviceSchema: "CNC",
            duration_ms: DURATION_S * 1000,
            source: "generated",
        },
        channels, samples,
    };
    process.stdout.write(JSON.stringify(doc));
    console.error(`channels: ${channels.length}, samples: ${samples.length}`);
}

main();

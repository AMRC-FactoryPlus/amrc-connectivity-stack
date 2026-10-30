/*
 * ACS Briefcase exporter
 * Describe a briefcase as an RO-Crate
 * Copyright 2026 University of Sheffield
 */

import { defined } from "./util.js";

export const RO_CRATE = "https://w3id.org/ro/crate/1.3";

const SPDX = "https://spdx.org/licenses/";
const EXPORTER_URL = "https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack";

/* The RO-Crate context has no term for a briefcase replacing an
 * earlier one, so this adds Dublin Core's. RO-Crate already uses
 * Dublin Core for conformsTo. */
const CONTEXT = [
    `${RO_CRATE}/context`,
    { replaces: "http://purl.org/dc/terms/replaces" },
];

const device_id = uuid => `#device-${uuid}`;

/* The entity for the terms the data is released under. */
function terms_entity ({ licence, agreement }) {
    if (licence) return {
        "@id":          `${SPDX}${licence}`,
        "@type":        "CreativeWork",
        name:           licence,
        identifier:     licence,
        description:    `The licence with the SPDX identifier ${licence}.`,
    };
    return {
        "@id":          "#agreement",
        "@type":        "CreativeWork",
        name:           "Data sharing agreement",
        identifier:     agreement,
        description:    "Use of this data is governed by the data sharing "
            + "agreement with this reference.",
    };
}

/** Build the RO-Crate metadata for a briefcase.
 *
 * The crate's root is the bag's `data/` directory, so every path is
 * relative to that.
 *
 * @param opts.briefcase The briefcase UUID.
 * @param opts.replaces The UUID of the withdrawn briefcase this one
 * replaces, if there is one.
 * @param opts.built When the briefcase was built, as an ISO 8601 string.
 * @param opts.dataset The description in `metadata/dataset.json`.
 * @param opts.policy The release policy.
 * @param opts.devices An array of `{ uuid, name }`.
 * @param opts.files An array of `{ path, name, description, format,
 * size, device?, first?, last? }`, where `device` is the UUID of the
 * device the file is about.
 * @param opts.exporter The exporter's version.
 * @param opts.source `{ organisation, url }` for the Factory+ instance.
 * @returns The `ro-crate-metadata.json` content.
 */
export function build_crate (opts) {
    const {
        briefcase, replaces, built, dataset, policy, devices, files,
        exporter, source,
    } = opts;
    const owner = policy.data_owner;
    const terms = terms_entity(policy.terms);
    const replaced = replaces && `urn:uuid:${replaces}`;

    const root = defined({
        "@id":              "./",
        "@type":            "Dataset",
        identifier:         { "@id": "#identifier" },
        replaces:           replaced ? { "@id": replaced } : null,
        name:               dataset.name,
        description:        dataset.description
            ?? `Data from the trial dataset ${dataset.name}, exported from Factory+.`,
        datePublished:      built,
        license:            { "@id": terms["@id"] },
        conditionsOfAccess: policy.permitted_use,
        publisher:          { "@id": "#data-owner" },
        keywords:           dataset.tags?.length ? dataset.tags : null,
        temporalCoverage:   dataset.from && dataset.to
            ? `${dataset.from}/${dataset.to}` : null,
        hasPart:            files.map(f => ({ "@id": f.path })),
        mentions:           { "@id": "#export" },
    });

    const graph = [
        {
            "@id":          "ro-crate-metadata.json",
            "@type":        "CreativeWork",
            conformsTo:     { "@id": RO_CRATE },
            about:          { "@id": "./" },
        },
        root,
        {
            "@id":          "#identifier",
            "@type":        "PropertyValue",
            name:           "Briefcase identifier",
            propertyID:     "UUID",
            value:          briefcase,
            url:            `urn:uuid:${briefcase}`,
        },
        ...files.map(f => defined({
            "@id":              f.path,
            "@type":            "File",
            name:               f.name,
            description:        f.description,
            encodingFormat:     f.format,
            contentSize:        String(f.size),
            about:              f.device ? { "@id": device_id(f.device) } : null,
            temporalCoverage:   f.first && f.last ? `${f.first}/${f.last}` : null,
        })),
        ...devices.map(d => ({
            "@id":          device_id(d.uuid),
            "@type":        "IndividualProduct",
            name:           d.name ?? d.uuid,
            identifier:     `urn:uuid:${d.uuid}`,
        })),
        terms,
        {
            "@id":          "#data-owner",
            "@type":        "Organization",
            name:           owner.organisation,
            contactPoint:   { "@id": "#contact" },
        },
        {
            "@id":          "#contact",
            "@type":        "ContactPoint",
            contactType:    "Data owner",
            name:           owner.contact.name,
            email:          owner.contact.email,
        },
        {
            "@id":          "#export",
            "@type":        "CreateAction",
            name:           "Export from Factory+",
            endTime:        built,
            agent:          { "@id": "#source" },
            instrument:     { "@id": "#exporter" },
            result:         { "@id": "./" },
        },
        defined({
            "@id":          "#source",
            "@type":        "Organization",
            name:           source.organisation
                ? `${source.organisation} Factory+` : "Factory+",
            url:            source.url,
        }),
        {
            "@id":          "#exporter",
            "@type":        "SoftwareApplication",
            name:           "ACS briefcase exporter",
            url:            EXPORTER_URL,
            version:        exporter,
        },
    ];

    /* Not a Dataset: RO-Crate would take that for one of this crate's
     * own data entities. */
    if (replaced) graph.push({
        "@id":          replaced,
        "@type":        "CreativeWork",
        name:           `Briefcase ${replaces}`,
        description:    "An earlier briefcase of this dataset, now withdrawn, "
            + "which this briefcase replaces.",
    });

    return {
        "@context":     CONTEXT,
        "@graph":       graph,
    };
}

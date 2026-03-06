/*
 * Factory+ RDF store
 * General utilities
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.util.Optional;
import java.util.UUID;
import java.net.URI;

import io.vavr.control.Try;

import org.apache.jena.rdf.model.*;

public class Vocab
{
    public static final String NS = "http://factoryplus.app.amrc.co.uk/rdf/";
    public static final String NS_uuid      = NS + "uuid/";
    public static final String NS_core      = NS + "core/";
    public static final String NS_graph     = NS + "graph/";

    private static Property coreP (String p) {
        return ResourceFactory.createProperty(NS_core + p);
    }

    public static final Property uuid       = coreP("uuid");

    private static Resource graph (String g) {
        return ResourceFactory.createResource(NS_graph + g);
    }

    public static final Resource G_direct   = graph("direct");
    public static final Resource G_derived  = graph("derived");

    public static final UUID U_RDFStore     = UUID.fromString(
        "8abf031c-193f-11f1-b047-d762a2934dfc");

    public static Resource fromUuid (UUID uuid)
    {
        return ResourceFactory.createResource(
            NS_uuid + uuid.toString());
    }

    public static Optional<UUID> uuidFromUri (String uri)
    {
        return Optional.of(uri)
            .filter(u -> u.startsWith(NS_uuid))
            .map(u -> u.substring(NS_uuid.length()))
            .flatMap(u -> Try.success(u)
                .mapTry(UUID::fromString)
                .toJavaOptional());
    }
}

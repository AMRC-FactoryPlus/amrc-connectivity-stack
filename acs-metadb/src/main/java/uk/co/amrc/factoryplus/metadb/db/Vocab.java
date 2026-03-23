/*
 * Factory+ RDF store
 * General utilities
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Optional;
import java.util.UUID;
import java.net.URI;

import io.vavr.control.Try;

import org.apache.jena.rdf.model.*;
import org.apache.jena.shared.PrefixMapping;
import org.apache.jena.sparql.core.Prologue;
import org.apache.jena.query.*;
import org.apache.jena.update.*;

public class Vocab
{
    public static final String NS = "http://factoryplus.app.amrc.co.uk/rdf/";
    public static final String NS_uuid      = NS + "uuid/";
    public static final String NS_core      = NS + "core/";
    public static final String NS_graph     = NS + "graph/";
    public static final String NS_app       = NS + "app/";

    public static Resource res (String r) {
        return ResourceFactory.createResource(NS + r);
    }
    public static Property prop (String p) {
        return ResourceFactory.createProperty(NS + p);
    }

    public static final Property uuid       = prop("core/uuid");
    public static final Property rank       = prop("core/rank");
    public static final Property primary    = prop("core/primary");
    public static final Property start      = prop("core/start");

    public static final Resource Special    = res("core/Special");
    public static final Resource Wildcard   = res("core/Wildcard");
    public static final Resource Unowned    = res("core/Unowned");

    public static final Resource Instant    = res("core/Instant");
    public static final Property timestamp  = prop("core/timestamp");

    public static final Resource Application    = res("core/Application");
    public static final Property forP           = prop("app/for");
    public static final Property value          = prop("app/value");
    public static final Resource Registration   = res("app/Registration");
    public static final Resource ConfigSchema   = res("app/ConfigSchema");

    public static final Resource G_direct   = res("graph/direct");
    public static final Resource G_derived  = res("graph/derived");

    public static final UUID U_RDFStore     = UUID.fromString(
        "8abf031c-193f-11f1-b047-d762a2934dfc");
    public static final UUID U_Unowned      = UUID.fromString(
        "091e796a-65c0-4080-adff-c3ce01a65b2e");

    public static Optional<UUID> parseUUID (String uuid)
    {
        /* Initial length check as UUID.fromString is too lenient. */
        if (uuid.length() != 36)
            return Optional.empty();

        try {
            return Optional.of(UUID.fromString(uuid)); 
        }
        catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
    
    public static Literal uuidLiteral (UUID uuid)
    {
        return ResourceFactory.createPlainLiteral(uuid.toString());
    }

    public static Resource uuidResource (UUID uuid)
    {
        return ResourceFactory.createResource(
            NS_uuid + uuid.toString());
    }

    public static Query query (String sparql)
    {
        var pro = new Prologue(PrefixMapping.Standard)
            .copy();
        var query = new Query(pro);
        return QueryFactory.parse(query, sparql, NS, Syntax.defaultQuerySyntax);
    }

    public static UpdateRequest update (String sparql)
    {
        /* The APIs here are annoyingly different */
        var prefixes = PrefixMapping.Factory.create()
            .setNsPrefixes(PrefixMapping.Standard);
        var update = new UpdateRequest();
        update.setPrefixMapping(prefixes);
        UpdateFactory.parse(update, sparql, NS);
        return update;
    }
}


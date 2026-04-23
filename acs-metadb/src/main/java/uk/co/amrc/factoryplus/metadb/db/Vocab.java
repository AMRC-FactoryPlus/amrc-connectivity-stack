/*
 * Factory+ RDF store
 * General utilities
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;
import java.net.URI;

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

    private static UUID U (String u) { return UUID.fromString(u); }

    public static final Property uuid       = prop("core/uuid");
    public static final Property rank       = prop("core/rank");
    public static final Property primary    = prop("core/primary");
    public static final Property deleted    = prop("core/deleted");

    public static final Resource Special    = res("core/Special");
    public static final Resource Wildcard   = res("core/Wildcard");
    public static final Resource Unowned    = res("core/Unowned");

    public static class Class {
        /* These are proper classes and don't have ranks or UUIDs */
        public static final Resource Object         = res("core/Object");
        public static final Resource Class          = res("core/Class");

        public static final Resource Individual     = res("core/Individual");
        public static final Resource R1Class        = res("core/R1Class");
        public static final Resource R2Class        = res("core/R2Class");
        public static final Resource R3Class        = res("core/R3Class");
        public static final Resource TopRank        = R3Class;
    }

    public static class Time {
        public static final Resource Instant        = res("time/Instant");

        public static final Property start          = prop("time/start");
        public static final Property timestamp      = prop("time/timestamp");
    }

    public static class Doc {
        public static final Resource Document       = res("doc/Document");

        public static final Property content        = prop("doc/content");
    }

    public static class App {
        public static final Resource Application    = res("app/Application");
        public static final Resource Structured     = res("app/Structured");
        public static final Resource Registration   = res("app/Registration");
        public static final Resource ConfigSchema   = res("app/ConfigSchema");
        public static final Resource Info           = res("app/Info");
        public static final Resource SparkplugAddr  = res("app/SparkplugAddress");

        public static final Property forP           = prop("app/for");
        public static final Property value          = prop("app/value");
    }

    /* This is for the bootstrap ACLs. */
    public static class Target {
        public static final UUID Registration = U("cb40bed5-49ad-4443-a7f5-08c75009da8f");
        public static final UUID SparkplugAddr = U("8e32801b-f35a-4cbf-a5c3-2af64d3debd7");
        public static final UUID Wildcard = U("00000000-0000-0000-0000-000000000000");
    }

    public static class Perm {
        public static final UUID ReadApp = U("4a339562-cd57-408d-9d1a-6529a383ea4b");
        public static final UUID WriteApp = U("6c799ccb-d2ad-4715-a2a7-3c8728d6c0bf");

        public static final UUID ListObj = U("6b4d73ea-50f1-11f0-9333-132037a152a5");
        public static final UUID CreateObj = U("ae09e2ba-50ef-11f0-ac03-1f9f5e6548be");
        public static final UUID CreateSpecificObj = U("e3491b9c-50f1-11f0-8e16-e75c8f93227b");
        public static final UUID ReadMembers = U("d4fd61da-50ef-11f0-ad24-335234e4c8a2");
        public static final UUID WriteMembers = U("c2759f6e-50ef-11f0-8730-ef0ba0514a0e");
        public static final UUID WriteMemberships = U("e08d89bc-50ef-11f0-8352-83e3d3d35028");
        public static final UUID ReadSubclasses = U("e6bb9978-50ef-11f0-b3c2-b79b9f64d2ff");
        public static final UUID WriteSubclasses = U("ed11bd2a-50ef-11f0-9f85-df13a1dff9e6");
        public static final UUID WriteSuperclasses = U("fb8e5048-50ef-11f0-91c5-7fd3cb373fbb");

        /* Currently unused */
        public static final UUID ReadMemberships = U("db9f5dae-50ef-11f0-b846-8393c17d1574");
        public static final UUID ReadSuperclasses = U("f590e476-50ef-11f0-a120-e7c6d06d79ed");

        public static final UUID DeleteObj = U("6957174b-7b08-45ca-ac5c-c03ab6928a6e");
        public static final UUID GiveTo = U("4eaab346-4d1e-11f0-800e-dfdc061c6a63");
        public static final UUID TakeFrom = U("6ad67652-5009-11f0-9404-73b79124c3d5");

        public static final UUID ReadRDF = U("d2b89414-3738-11f1-86d5-573f5f0cb628");
        public static final UUID WriteRDF = U("d92c30f8-3738-11f1-8daa-33e4253b6bac");
    }

    public static final Resource G_direct   = res("graph/direct");
    public static final Resource G_derived  = res("graph/derived");
    public static final Resource G_added    = res("graph/added");
    public static final Resource G_removed  = res("graph/removed");

    public static final UUID U_RDFStore     = U("8abf031c-193f-11f1-b047-d762a2934dfc");
    public static final UUID U_Unowned      = U("091e796a-65c0-4080-adff-c3ce01a65b2e");

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


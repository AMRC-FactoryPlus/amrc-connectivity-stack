/*
 * Factory+ metadata database
 * Object relations exposed via the API
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import io.vavr.collection.*;
import io.vavr.control.*;

import uk.co.amrc.factoryplus.service.SvcErr;

public record Relation (String name, Property prop, int offset,
    UUID readClass, /*UUID readObj,*/ UUID writeClass, UUID writeObject)
{
    private static List<Relation> known = List.of(
        new Relation("member", RDF.type, 1, 
            Vocab.Perm.ReadMembers, /*Vocab.Perm.ReadMemberships,*/
            Vocab.Perm.WriteMembers, Vocab.Perm.WriteMemberships),
        new Relation("subclass", RDFS.subClassOf, 0,
            Vocab.Perm.ReadSubclasses, /*Vocab.Perm.ReadSuperclasses,*/
            Vocab.Perm.WriteSubclasses, Vocab.Perm.WriteSuperclasses));

    public static Option<Relation> find (String relation)
    {
        return known.find(r -> r.name.equals(relation));
    }

    public static Relation of (String relation)
    {
        return find(relation)
            .getOrElseThrow(() -> new SvcErr.NotFound("No such relation"));
    }

    public static record Bound (Relation relation, UUID uuid, boolean asClass)
    {
        public Property prop () { return relation.prop(); }
        public Literal literal () { return Vocab.uuidLiteral(uuid); }

        public String selectVar () { return asClass ? "classU" : "objU"; }
        public String resultVar () { return asClass ? "objU" : "classU"; }
    }

    public Bound bind (UUID uuid, boolean asClass)
    {
        return new Bound(this, uuid, asClass);
    }
    public Bound bindClass (UUID uuid) { return bind(uuid, true); }
    public Bound bindObject (UUID uuid) { return bind(uuid, false); }
}


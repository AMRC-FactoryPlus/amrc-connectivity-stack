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

/* These are the object structure relations we know about. Currently
 * this is just memberOf and subclassOf, but potentially it could
 * include powersetOf in the future. */
public record Relation (
    String name,        // the name used in the HTTP API
    Property prop,      // the RDF property
    int offset,         // the rank offset between subj and obj
    // permissions
    UUID readClass, UUID readObject, UUID writeClass, UUID writeObject)
{
    public static final List<Relation> KNOWN = List.of(
        new Relation("member", RDF.type, 1, 
            Vocab.Perm.ReadMembers, Vocab.Perm.ReadMemberships,
            Vocab.Perm.WriteMembers, Vocab.Perm.WriteMemberships),
        new Relation("subclass", RDFS.subClassOf, 0,
            Vocab.Perm.ReadSubclasses, Vocab.Perm.ReadSuperclasses,
            Vocab.Perm.WriteSubclasses, Vocab.Perm.WriteSuperclasses));

    public static Option<Relation> find (String relation)
    {
        return KNOWN.find(r -> r.name.equals(relation));
    }

    public static Relation of (String relation)
    {
        return find(relation)
            .getOrElseThrow(() -> new SvcErr.NotFound("No such relation"));
    }

    public static record Bound (Relation relation, UUID uuid,
        boolean asClass, boolean direct)
    {
        public Resource graph () { return direct ? Vocab.G_direct : Vocab.G_derived; }
        public Property prop () { return relation.prop(); }
        public Literal literal () { return Vocab.uuidLiteral(uuid); }

        public String selectVar () { return asClass ? "classU" : "objU"; }
        public String resultVar () { return asClass ? "objU" : "classU"; }

        public UUID perm ()
        {
            if (direct) {
                return asClass ? relation.writeClass() : relation.writeObject();
            }
            else {
                return asClass ? relation.readClass() : relation.readObject();
            }
        }
    }

    public Bound bind (UUID uuid, boolean asClass, boolean direct)
    {
        return new Bound(this, uuid, asClass, direct);
    }
}


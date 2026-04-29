/*
 * Factory+ metadata database
 * ZFC class structure validation
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public record ZFC (RdfStore db)
{
    private static final Logger log = LoggerFactory.getLogger(ZFC.class);

    private static final Query V_dupUUID = Vocab.query("""
        select ?obj
        where {
            ?obj <core/uuid> ?objU.
        }
        group by ?obj
        having (count(?objU) != 1)
    """);
    private static final Query V_dupIRI = Vocab.query("""
        select ?objU
        where {
            ?obj <core/uuid> ?objU.
        }
        group by ?objU
        having (count(?obj) != 1)
    """);
    private static final Query V_badPrimary = Vocab.query("""
        select ?objU
        where {
            ?obj <core/uuid> ?objU.
            optional { ?obj <core/primary> ?primary. }
            filter not exists { <core> <sys/topRank> ?obj. }
        }
        group by ?objU
        having (count(?primary) != 1)
    """);
    private static final Query V_badRank = Vocab.query("""
        select ?objU (group_concat(?rank) as ?ranks)
        where {
            ?obj <core/uuid> ?objU.
            optional { ?obj rdf:type/<core/rank> ?rank. }
            filter not exists { <core> <sys/topRank> ?obj. }
        }
        group by ?objU
        having (count(?rank) != 1)
    """);
    private static final Query V_relRank = Vocab.query("""
        select ?objU ?classU
        where {
            ?obj <core/uuid> ?objU;
                rdf:type/<core/rank> ?objR.
            ?class <core/uuid> ?classU; 
                rdf:type/<core/rank> ?classR.
            ?obj ?prop ?class.
            filter (?classR != ?objR + ?offset)
        }
    """);
    private static final Query V_notPrimary = Vocab.query("""
        select ?objU
        where {
            ?obj <core/uuid> ?objU; <core/primary> ?class.
            filter not exists { ?obj a ?class. }
        }
    """);
    /* We verify that all R1+ object are subclasses of Object. Given the
     * rank relation check above this ensures subclass consistency. */
    private static final Query V_notSubclass = Vocab.query("""
        select ?objU
        where {
            ?obj <core/uuid> ?objU; 
                rdf:type/<core/rank> ?rank.
            filter (?rank > 0)
            filter not exists { ?obj rdfs:subClassOf <core/Object>. }
        }
    """);
    private static final Query V_indSubclass = Vocab.query("""
        select ?objU
        where {
            ?objU a <core/Individual>; rdfs:subClassOf ?class.
        }
    """);

    private static UUID getU (QuerySolution qs, String arg)
    {
        return Util.decodeLiteral(qs.get(arg), UUID.class);
    }

    private void _validateObjs (String msg, Query query)
    {
        log.info("checking {}", msg);
        var bad = db().listQuery(query);
        if (!bad.isEmpty()) {
            var uuids = bad.map(qs -> getU(qs, "objU"));
            log.error("{}: {}", msg, uuids);
            throw new RdfErr.InvalidObjs(msg, uuids);
        }
    }

    /* This will throw if it detects a problem. */
    public void validateInvariants ()
    {
        log.info("Validating class structure invariants");

        log.info("checking for IRIs with multiple UUIDs");
        var badIris = db().listQuery(V_dupUUID);
        if (!badIris.isEmpty()) {
            var iris = badIris.map(qs -> qs.getResource("obj"));
            log.error("IRI with multiple UUIDs: {}", iris);
            throw new RdfErr.InvalidIris("IRI with multiple UUIDs", iris);
        }

        _validateObjs("UUID with multiple IRIs", V_dupIRI);
        _validateObjs("Bad primary class", V_badPrimary);
        _validateObjs("Invalid ranks", V_badRank);

        for (var rel : Relation.KNOWN) {
            log.info("checking {}", rel.name());
            var badRel = db().listQuery(V_relRank, 
                "prop", rel.prop(), "offset", Util.intLiteral(rel.offset()));
            if (!badRel.isEmpty()) {
                var rels = badRel.toMap(qs -> getU(qs, "objU"), qs -> getU(qs, "classU"));
                log.error("Invalid {}: {}", rel.name(), rels);
                throw new RdfErr.InvalidRels("Invalid " + rel.name(), rels);
            }
        }
        
        _validateObjs("Not member of primary class", V_notPrimary);
        _validateObjs("Not subclass of rank root", V_notSubclass);
        _validateObjs("Individuals may not be subclasses", V_indSubclass);
    }
}

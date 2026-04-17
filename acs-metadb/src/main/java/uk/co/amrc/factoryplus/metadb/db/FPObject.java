/*
 * Factory+ metadata database
 * Factory+ object record
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import org.apache.jena.rdf.model.*;

public record FPObject (Resource node, UUID uuid)
{
}

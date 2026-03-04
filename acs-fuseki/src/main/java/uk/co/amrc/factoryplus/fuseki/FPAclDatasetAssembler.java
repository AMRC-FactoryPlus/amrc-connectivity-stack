/*
 * ACS Fuseki
 * ACL-enabled Dataset Assembler
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.assembler.Assembler;
import org.apache.jena.assembler.Mode;
import org.apache.jena.query.Dataset;
import org.apache.jena.query.DatasetFactory;
import org.apache.jena.rdf.model.Resource;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.assembler.DatasetAssembler;
import org.apache.jena.sparql.core.assembler.DatasetAssemblerVocab;

public class FPAclDatasetAssembler extends DatasetAssembler implements Assembler {
    final Logger log = LoggerFactory.getLogger(FPAclDatasetAssembler.class);

    public FPAclDatasetAssembler () {
        log.info("Constructed assembler");
    }

    @Override
    public Dataset open(Assembler a, Resource root, Mode mode) {
        log.info("open: {} {} {}", a, root, mode);
        var ds = createDataset(a, root);
        return DatasetFactory.wrap(ds);
    }

    @Override
    public DatasetGraph createDataset(Assembler a, Resource root) {
        var base = createBaseDataset(root, DatasetAssemblerVocab.pDataset);
        log.info("Created base dataset: {}", base);
        var ds = FPDatasetGraph.withBase(base);
        log.info("Wrapped dataset: {}", ds);
        return ds;
    }
}

/*
 * ACS Fuseki
 * Build a ShEx expression from RDF
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.apache.jena.graph.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.riot.system.PrefixMapFactory;
import org.apache.jena.shex.*;
import org.apache.jena.shex.expressions.*;
import org.apache.jena.vocabulary.RDF;

class FPShapeBuilder {
    private Model model;
    private List<ShexShape> shapes;
    private List<Triple> mayRead;

    class InvalidShape extends RuntimeException {
        public InvalidShape (Resource r) {
            super("Invalid shape: " + r.toString());
        }
    }
    class InvalidUser extends RuntimeException {
        public InvalidUser (String u, String reason) {
            super("Invalid user: " + u + ": " + reason);
        }
    }

    public FPShapeBuilder (Graph g) {
        this.model = ModelFactory.createModelForGraph(g);
        this.shapes = new ArrayList<ShexShape>();
        this.mayRead = new ArrayList<Triple>();
    }

    public FPShapeEvaluator build () {
        var prefixes = new PrefixMapFactory().create();
        prefixes.add("rdf", RDF.getURI());
        prefixes.add("shex", ShEx.NS);
        prefixes.add("acl", Vocab.NS);

        var schema = ShexSchema.shapes(
            /*source*/"", /*baseURI*/"",
            prefixes, /*startShape*/null,
            shapes, 
            /*imports*/List.of(), 
            /*semActs*/List.of(), 
            /*tripleRefs*/Map.of());

        return new FPShapeEvaluator(schema, List.copyOf(mayRead));
    }

    public FPShapeBuilder withPrincipal (String user) {
        var princ = getIriForUser(user);
        model.listObjectsOfProperty(princ, Vocab.readTriple)
            .filterKeep(c -> c.isResource())
            .mapWith(c -> c.asResource())
            .forEach(c -> addCondition(mayRead, c));
        return this;
    }

    public Resource getIriForUser (String user) {
        var princs = model.listResourcesWithProperty(Vocab.username, user)
            .toList();
        if (princs.size() > 1)
            throw new InvalidUser(user, "more than one IRI");
        if (princs.size() < 1)
            throw new InvalidUser(user, "no IRI");
        return princs.get(0);
    }

    public void addCondition (List<Triple> acl, Resource r) {
        var tr = Triple.create(
            addShapeFor(r, Vocab.subject),
            addShapeFor(r, Vocab.predicate),
            addShapeFor(r, Vocab.object));
        acl.add(tr);
    }

    public Node addShapeFor (Resource r, Property p) {
        var obj = model.getProperty(r, p);
        if (obj == null)
            return Node.ANY;

        var expr = obj.getObject().asResource();
        var label = expr.asNode();
        var shape = new ShexShape(label, buildExpr(expr));

        shapes.add(shape);
        return label;
    }

    public ShapeExpression buildExpr (Resource r) {
        if (model.contains(r, RDF.type, ShEx.TripleConstraint))
            return buildTripleConstraint(r);
        if (model.contains(r, RDF.type, ShEx.NodeConstraint))
            return buildNodeConstraint(r);
        throw new InvalidShape(r);
    }

    public ShapeExpression buildTripleConstraint (Resource r) {
        var pred = model.getRequiredProperty(r, ShEx.predicate)
            .getObject().asNode();
        var expr = buildExpr(model
            .getProperty(r, ShEx.valueExpr)
            .getObject().asResource());
        var tc = new TripleConstraint(r.asNode(), pred, false, expr,
            new Cardinality("", 1, 1), null);
        return ShapeExprTripleExpr.newBuilder()
            .label(r.asNode())
            .shapeExpr(tc)
            .build();
    }

    public ShapeExpression buildNodeConstraint (Resource r) {
        var values = model.getRequiredProperty(r, ShEx.values)
            .getList()
            .mapWith(n -> n.asResource().getURI())
            .mapWith(i -> new ValueSetRange(i, null, null, false))
            .toList();
        var vc = new ValueConstraint(values);
        var nc = new NodeConstraint(List.of(vc));
        return new ShapeNodeConstraint(nc, null);
    }
}

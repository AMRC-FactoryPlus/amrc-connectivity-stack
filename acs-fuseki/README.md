# ACS Fuseki plugin

This is a sketch of a plugin to make Apache Jena Fuseki suitable for use
as an RDF graph service within ACS. The principle feature missing is
robust tripe-level access control; this plugin gives an outline of how
this might be provided.

## Building and running

You will need Java, a JDK and Maven. Other dependencies will be
downloaded by Maven as required. You will need `java` and `mvn` in your
`PATH`, and may need to set `JAVA_HOME` and/or `M2_HOME` in the
environment.

To build, run

    mvn -B package

This will download the deps and build a JAR in
`target/acs-fuseki-0.0.1.jar`. This is a build of Fuseki Main, i.e. the
triplestore without the UI. Run with

    java -jar target/acs-fuseki-0.0.1.jar --config=config.ttl

This will run a triplestore exposing a SPARQL endpoint at
`http://localhost:3030/ds/sparql`, accepting queries and update
operations. The database will be created in the `db` directory.

## Namespaces

These namespaces are relevant:

    prefix shex: <http://www.w3.org/ns/shex#> .
    prefix acl: <http://factoryplus.app.amrc.co.uk/rdf/2025-05/ac-24-611/acl#> .

## Features

Access control is only implemented on query; all updates are permitted.
The username to authorise is taken from an HTTP Basic Auth header; the
password is ignored. Obviously this would need integrating properly into
an authentication framework eventually but that's not the point at the
moment.

ACLs live in the dataset, in the default graph. ACLs in other graphs are
ignored; I am assuming for the moment that these will represent
hypotheticals or other forms of information and should not be used for
access control. Generally access to named graphs is not considered
properly yet.

A principal is identified by an IRI and a string username; the username
is linked to the IRI by an `acl:username` property. Permission grants
are also linked, with `acl:readTriple` properties. The permission model
is deny by default with grant permissions only. The range of
`acl:readTriple` is the class `acl:ShexCondition`; an object of this
class represents a condition on triples expressed in the
[ShEx](https://shex.io) expression language.

ShEx is intended for schema validation; it's basically an alternative to
SHACL. It isn't entirely suitable for this purpose but is the only
expression language implementation easily available within Jena. The
primary concept in ShEx is the Shape, which can be seen as a condition a
node must satisfy, both in terms of its internal properties
(IRI/blank/literal, datatype and content if literal) and in terms of its
links to other nodes. Normally the validation process accepts a list of
Shapes and a ShapeMap which determines which nodes must match which
Shapes, and a graph passes validation if all relevant nodes conform.

The Jena ShEx implementation makes it possible to evaluate a particular
node against a particular shape without needing to validate the whole
graph. We are using this to implement access control. An
`acl:ShexCondition` object has three properties: `acl:subject`,
`acl:predicate` and `acl:object`. These are all optional but if present
must be a ShEx shape expression; a `shex:TripleConstraint` or a
`shex:NodeConstraint`. A triple passes the constraint (access will be
granted) if each member of the triple conforms to the specified shape;
if a property is omitted then any value passes.

Currently a very small subset of ShEx is supported, consisting of:

* NodeConstraints with `shex:values` only.
* TripleConstraints with `shex:predicate` and `shex:valueExpr` only.

Cardinalities other than 'exactly one' are not supported, nor are the
logical operations or any conditions on literals.

## Example

An example user account with some permission grants might be:

    prefix ex: <http://example.org#> .

    ex:user acl:username "user";
        acl:readTriple [
            a acl:ShexCondition;
            acl:subject [
                a shex:TripleConstraint;
                shex:predicate rdf:type;
                shex:valueExpr [
                    a shex:NodeConstraint;
                    shex:values (ex:Class);
        ]]].

This permits the `user` user to read any triples with a subject in the
class `ex:Class`.

## Implementation

The ACL layer is implemented primarily in a DatasetGraph subclass; this
is an object which presents an RDF dataset to the rest of Jena. An
Assembler module is provided which can be used in the config file to
create an FPDatasetGraph; this wraps another dataset and implements
access control.

The DatasetGraph API does not have access to request information to
perform authorisation. For this reason we search for endpoints accessing
our dataset and replace the sparql query operation handler with a
subclass; this deals with extracting the username from the request and
injecting it into the dataset used to perform the query.

The ShEx shapes are stored in the graph; unfortunately, although ShEx is
defined as an RDF data model, the Jena implementation can only parse
shapes from JSON or ShExC files. This means we need to traverse the RDF
and build the ShapeExpression objects by hand; this is why only a subset
of ShEx is currently implemented. This job is performed by an
FPShapeBuilder, which builds an FPShapeEvaluator containing a ShexSchema
and a list of triples representing the ShexConditions. Currently this
step is performed for every request but this could be optimised.

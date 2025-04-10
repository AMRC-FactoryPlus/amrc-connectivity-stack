# Factory+ object model

This describes the theoretical foundation for the object model used by
ACS v4, and the implementation of this in the ConfigDB.

The following notation is used. For more detail see the definitions
below.

* A _Name in italics_ is the name of an object.
* The notation _Member_ ∈ _Class_ means that _Member_ is a member of
  _Class_ .
* The notation _Subclass_ ⊂ _Superclass_ means that _Subclass_ is a
  subclass of _Superclass_.
* The notation 𝒫 _Class_ indicates the power set of _Class_ (see below).
* The notation _One_ = _Two_ indicates that either _One_ and _Two_ are
  different names for the same individual, or that the classes _One_ and
  _Two_ have the same members.

## Theoretical model

The following concepts are used. (For those who know the technical
details, this is a restricted version of NBG set theory.)

* A _class_ is a collection of things. There may or may not be any
  obvious connection between the things in a class, but it must be
  possible to decide definitely, given anything at all, whether it is in
  the class or not.

* Classes are completely defined by their membership: if two classes
  have the same members, they are equal; we have two names for the same
  class.

* An _object_ is a member of a class. Objects in Factory+ fall into two
  categories: individuals and sets (see below). An object may be a
  member of any number of classes, but every object must be a member of
  at least one class.

* An _individual_ is anything which is not a class. All real physical
  objects are individuals. Currently some things are classified as
  individuals where they should properly be classes; this will change as
  our data model develops.

* A _set_ is both a class and an object; a class which is a member of
  another class. All classes currently defined by Factory+ are sets.

* If all members of class A are also members of class B then A is a
  _subclass_ of B. Every class is a subclass of itself.

* The _rank_ of an object defines how deeply it is nested, in terms of
  classes within classes. Individuals are rank 0. Rank 1 classes contain
  only individuals; rank 2 classes contain only rank 1 classes, and so
  on. Currently Factory+ only allows objects that fit into one of these
  ranks; classes of mixed rank are not allowed.

* Given a class A, the _power set_ of A is the class containing all
  subclasses of A. This class contains A and is necessarily one rank
  higher than A. Factory+ does not explicitly implement powersets but
  the concept is important in some places.

By convention class names are singular and describe one of their
members, so the class of all trees would be called _Tree_ rather than
_Trees_. The words _group_, _set_, _type_, _kind_ in the name of a class
normally indicate this is a class of classes. More specifically, _Foo
group_ normally indicates 𝒫 _Foo_ (all collections of Foos), and _Foo
type_ indicates a partition of _Foo_, which is a subclass of 𝒫 _Foo_
such that every member of _Foo_ is a member of exactly one member of
_Foo type_.

The class _Individual_ contains all individuals (rank 0 objects). This
is a rank 1 class, and is in fact a superclass of all rank 1 classes.
Similarly, _Rank 1 class_ is a rank 2 class containing all rank 1
classes, and is the superclass of all rank 2 classes. (_Rank 1 class_ is
in fact the powerset of _Individual_). In principle this continues for
ever.

The rank system restricts the possible members and subclasses of a given
class. A subclass is always the same rank as its parent class; a class
member is always one rank lower than the class rank. This makes it
impossible for a class to be a member of itself; this is necessary to
avoid certain logical contradictions (allowing this would allow classes
where it was impossible to tell if some things were members of the class
or not).

## Practical implementation

The ConfigDB implements the theoretical model above as follows:

* Objects and classes are identified by UUIDs. They may also be assigned
  names in the _General information_ config entries.

* The _Object registration_ config entry records a numerical rank and a
  class for every object. This class is the _primary class_ for the
  object; this should not in general be used by machines to make
  decisions, but should be chosen to identify to humans what sort of
  thing this is. The ConfigDB editor UI displays primary class names in
  brackets after the name of an object.

* For classes, additional 'direct' members and subclasses may be added
  via the API. These will be expanded recursively, so that if we have
  direct relations `X ⊂ Y, A ⊂ X, B ∈ X, C ∈ A` then the membership and
  subclass APIs will also return `A ⊂ Y, B ∈ Y, C ∈ Y`.

* Access to read the direct members and subclasses of a class is
  restricted to those who have edit access. Clients with read-only
  access will only be able to read the derived membership. No
  significance should be attached to whether a membership or subclass
  relation is direct or derived.

* Redundant direct subclass relations will be automatically removed. So
  if we have `A ⊂ B, C ⊂ B` and we add `A ⊂ C` then `A ⊂ B` will be
  removed as a direct relation; it will of course still exist as a
  derived relation.

* The rank superclasses _Individual_, _Rank 1 class_ and so on are
  implemented with well-known UUIDs. Ranks up to _Rank 3 class_ are
  implemented currently. The only way to extend the list of ranks is a
  ConfigDB upgrade. The highest currently-defined rank has no `class` in
  its _Object registration_ entry as we don't have a UUID for the
  next-highest rank yet.

* The rank of an object can be changed via a PUT or PATCH request to the
  _Object registration_ config entry. The request must update both the
  `rank` and `class` properties at the same time in a compatible way
  (the rank of the `class` must be one more than `rank`). This is to
  avoid errors; re-ranking an object is a destructive operation, as it
  will necessarily lose all its current memberships and superclasses.

## Future directions

The theoretical model in use (NBG set theory) allows the following
categories of classes which are not currently implemented:

* Classes of mixed rank can be permitted without contradictions by
  defining _types_. A type consists of the union of all classes at or
  below a given rank; so a type 1 class is the same as rank 1 class, but
  a type 2 class may contain both individuals and type 1 classes, and so
  on.

* Once types are allowed, we can allow type Ω classes, which contain
  classes nested to arbitrary finite depth. The class _Object_
  containing all objects is a type Ω class; this is the superclass of
  all sets.

* The classes **Rank** and **Set**, the first containing _Individual_,
  _Rank 1 class_ and so on, and the second containing all sets, cannot
  be defined as sets; this leads to contradictions. However they can be
  defined as _proper classes_ (named in bold to distinguish them), which
  are allowed to have members but are not allowed to be members of other
  classes.

Other changes which would be desirable are:

* There are many uses for derived classes, that is classes whose
  membership is defined by some rule rather than by explicit
  specification of direct members and subclasses. For example: automatic
  population of power sets; set operations such as union and
  intersection; dynamic classification of objects based on the contents
  of ConfigDB entries.

* Currently many objects are classified as individuals when they should
  not be. Ideally only real-world physical objects should be
  individuals; anything else is more properly represented as some kind
  of class of real-world objects.

* At present the membership of a class changes over time. This makes it
  difficult to reason about the properties of a class or an object. A
  better model is to explicitly introduce change over time into the data
  by modelling the various states of an object over its lifetime and
  classifying those; this is called the 4-dimensional approach.

* The relation of wholes and parts (such as: this motor is part of this
  robot) can be represented as a subclass relation if physical objects
  themselves are promoted to being rank 1 classes. This would mean our
  only individuals would be points in space-time, which would not want
  to be represented directly.

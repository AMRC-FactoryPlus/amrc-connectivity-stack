# Auth service redesign

The Auth service was originally designed to replace the existing MQTT
ACL and CCL databases. An analysis of these came up with the current
principal-permission-target-group model. While this is simple and easy
to understand it is proving not to be flexible enough now that the scope
has expanded.

Terminology: the _consuming service_ is an F+ service using the Auth
service to provide ACLs. The consuming service is a client of the Auth
service. The _requesting client_ is a client of the consuming service
which is being authorised using the information from the Auth service.
An _external service_ is a service other than the Auth service which
provides information used in making authorisation decisions.

## Problems with the current system

### Sparkplug Node address is a security identifier

During the development of the cmdesc service I have realised that a
Sparkplug Node is a security principal. Node address information should
live in the Auth service; a Node address is simply an alternative
identifier for the principal.

### Lack of group quoting

When a group is included into another group no distinction is made
between 'subset' and 'member-of'. A group is always expanded recursively
and appears as a subset of the larger group. This means any grant of
permission to edit groups becomes unrestricted, as the principal can add
any group (Administrators, say) to a group they can edit and can then
add themself to that group.

### Groups are becoming difficult to manage

A large number of groups are needed, and they are becoming difficult to
identify. Any scheme for dynamically creating groups (Devices belonging
to a Node, for instance) will make this much worse. Classification of
groups for management purposes (as opposed to amalgamation) is not
possible due to the lack of quoting.

### Auth information in the ConfigDB

Both MQTT and CCL permissions are dynamic, with the meaning of a
permission specified in application terms in the ConfigDB. Additionally,
both ConfigDB entries contain lists, and the MQTT entries are expanded
with address information from the target. This indicates that the Auth
data model is not sufficient for the requirements here.

### Targets are inflexible

Some permissions, especially Auth permissions (permissions to change
permissions), require more parameters than a simple target. This leads
to either distortion of the permission model or overly broad grants. For
example:

* Auth: 'Manage ACLs (per permission)' is always an overly broad grant.
  We should be able to restrict all three parts of the ACE.
* Auth: 'Manage groups' only restricts the groups managed, not who can
  be placed in them.
* Directory: Third-party service advert permissions are convoluted to
  avoid needing multiple targets.
* Directory: 'Read alerts of type' and 'Read alerts from device'
  are separate permissions. Combinations are not possible.
* ConfigDB: 'Read/Write config' are often too broad. Restriction on
  object would be useful.
* Cmdesc: CCL permissions grant a metric and type together. No
  restriction can be placed on value.
* Git: Restrictions are only at the repo level. Per-branch restrictions
  cannot be expressed.

### No change-notify

The Auth service has no change-notify interface. With the `notify/v2`
spec which does not rely on Sparkplug it would be possible to create a
change-notify interface for the Auth service which doesn't cause
bootstrapping problems.

## Possible solutions

### More ConfigDB-driven permissions

It would be possible to keep pushing most of the information needed to
grant a permission into custom ConfigDB entries, leaving one piece to be
`target`. With both `permission` and `target` expanded via the ConfigDB
this can be quite flexible, if rather ad-hoc. This is effectively how
the current MQTT permissions work.

### Dynamic groups

It might be possible to define Auth groups with dynamic membership,
whether based on other groups, ConfigDB entries, or Directory
information. There is a high risk here of ACL resolution becoming
unacceptably slow. There is also a risk of information leak where
consuming services use these dynamic groups to see information they
shouldn't.

Alternatively groups could be updated by external services. Some of this
happens already with service-setup and the edge cluster machinery. This
can be awkward to set up, as the UUIDs of these groups need to be
recorded somewhere so they can be updated.

A third, and better, option for ACLs dependent on the contents of
external services is to pass responsibility for querying the external
services back to the consuming service. This means that the consuming
service is subject to normal ACLs from the external service, and can
subscribe to change-notify from the external service on its own account.
The biggest issue here will be working out how to pass the information
about which endpoint(s) to use on which service in a sufficiently
generic way.

### Structured targets

Some of these problems can be solved by allowing the target of an ACE to
be more than just a UUID. Triples work for RDF, but only because the IRI
used as object can itself have structure. 

This is obviously equivalent to referencing a ConfigDB application, but
keeps the relevant information in the Auth service. It also avoids
creating large numbers of fairly ephemeral ConfigDB objects.

### Permission templates

The MQTT and CCL permissions both expand into lists of the real
permissions applicable to the service concerned using ConfigDB entries
as templates. Given an appropriate template language, it would be
possible for this expansion to happen inside the Auth service. It would
be necessary to also support structured targets, as the targets for MQTT
and CCL permissions cannot be reasonably represented as a single UUID.

This still leaves the question of how to handle data from external
services: leaving the job to the consuming service potentially requires
a complex service library implementation and means the consuming service
needs access to all the data it needs to evaluate the ACL. On the other
hand providing a complete, dynamic ACL resolution function on the Auth
service means the Auth service needs to consume notifications from the
relevant external services, which opens up the bootstrapping problem
again.

## Design proposals

All proposals need to meet these conditions:

* Groups distinguish between member-of and subset-of containment.

* The set of members of a group `GROUP` is defined as follows: if
  `GROUP` is not a group, the result is `GROUP`. Otherwise, the result
  is all members-of the group `GROUP`, plus `members SUBGROUP` for all
  subsets-of `GROUP`. Groups are sets, so the result is uniqed.

* Principals always have a UUID, and have at most one each of a Kerberos
  UPN and a Sparkplug Node address. These additional identifiers are
  stored in the Auth service and are checked for uniqueness.

* Values which might change need to have change-notify. This includes
  group membership. It must be acceptable for services not to respond to
  changes instantly.

* The target of an ACE is a structured value.

* It must be possible to create groups of principals and to grant
  permissions to all members of the group.

### Permission templates

[Full proposal](./auth/sexpr.md).

This proposal is intended as a simple way to define a JSON-based
expression language which can be used to express rich permission
structures. It also allows the Auth service to reply to an ACL query
with partially evaluated rules where the final result depends on lookups
from other services; the final expansion must be performed by the
consuming service based on change-notify channels.

The result is more complex than I hoped it would be, in particular the
partial evaluation is difficult to handle correctly. 

### Dynamic groups

[Full proposal](./auth/dyn-groups.md).

This is intended as a simplest-possible proposal while still meeting the
conditions above.

# Auth service redesign

The Auth service was originally designed to replace the existing MQTT
ACL and CCL databases. An analysis of these came up with the current
principal-permission-target-group model. While this is simple and easy
to understand it is proving not to be flexible enough now that the scope
has expanded.

## Problems with the current system

### Sparkplug Node address is a security identifier

During the development of the auth service I have realised that a
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
to a Node, for instance) will make this much worse.

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
* The new change-notify system means services need to be able to create
  Devices under their own Node and grant permissions to them.
* A reconciliation service will need to create Devices under random
  Nodes and grant permissions to them.

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
unacceptably slow.

Alternatively groups could be updated by services. Some of this happens
already with service-setup and the cluster manager service.

### Owners

Can any of these problems be simplified by introducing the general
concept of an 'owner'? This might allow a reconciliation service to be
owner of a Device rather than the Node which is publishing it.

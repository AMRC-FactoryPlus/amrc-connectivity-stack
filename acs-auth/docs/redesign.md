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
* The new change-notify system means services need to be able to create
  Devices under their own Node and grant permissions to them.
* A reconciliation service will need to create Devices under random
  Nodes and grant permissions to them.

### No change-notify

The Auth service has no Sparkplug presence and no change-notify
interface. Trying to create these is likely to open a large can of
worms; one of the design principles of the Auth service is that it is
entirely standalone and doesn't depend on any of the other services.

This means that, in general, changes to data in the Auth service will
not be picked up quickly. This in turn suggests that in a dynamic
environment the Auth data should be rules for assimilating other data
sources rather than specific lists of objects that can be accessed.

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

### Owners

Can any of these problems be simplified by introducing the general
concept of an 'owner'? This would need to be registered with the Auth
service by the ConfigDB at the point where the object was created. This
might allow a reconciliation service to be owner of a Device rather than
the Node which is publishing it, for example. More generally it should
allow restricting the actions of services to objects they have created,
where this is useful.

### Structured targets

Some of these problems can be solved by allowing the target of an ACE to
be more than just a UUID. SPO works for RDF, but only because the IRI
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

## Design proposal

* Groups can only be used for principals or targets (nouns). Groups of
  permissions are no longer expanded.

* Groups distinguish between member-of and subset-of containment.

* The function `members GROUP` is defined as follows: if `GROUP` is not
  a group, the result is `GROUP`. Otherwise, the result is all
  members-of the group `GROUP`, plus `members SUBGROUP` for all
  subsets-of `GROUP`. Groups are sets, so the result is uniqed.

* Principals always have a UUID, and have at most one each of a Kerberos
  UPN and a Sparkplug Node address. These additional identifiers are
  stored in the Auth service and are checked for uniqueness.

* The principal of an ACE is always a UUID and is always expanded with
  `members`. The ACE is granted to any identifier belonging to a UUID on
  the resulting list. Principal UUIDs should not normally be used as
  group UUIDs.

* The target of an ACE is a JSON value, which must be either an object,
  a string or `null`. Arrays are reserved to represent template calls.
  In some cases this will be a string representing a UUID but this is up
  to the service to interpret. Wildcards and group expansion are also up
  to the service.

* A permission is always a UUID. There are two categories of permission:
  base permissions which are returned to the requesting service, and
  permission templates. Templates are defined in the Auth service and
  permissions defined as templates will never be returned to a service.

### Permission templates

A permission template is a function which accepts the principal UUID and
the target value and returns a list of ACEs. When ACLs are looked up all
permission templates are expanded recursively and the result included in
the list of ACEs returned. Some form of recursion control will obviously
be necessary.

A template definition is represented in JSON as an s-expression built
from arrays and strings.

* A 'base value' is `null`, a string, or an object whose values are all
  base values.

* An array represents a function call. The first member of the array
  names the function to call. If this is a string it names a builtin, a
  `let` binding, or a permission UUID. If this is an object the function
  is an indexing operation.

* Certain strings name builtins. These are: `list`, `let`, `merge`,
  `if`, `has`, `equal`, `map`, `join`, `format`, `members`, `id`.

* Let bindings are created with the `let` builtin and are only available
  over the scope of the call to `let`. Function arguments are available
  as though they were `let` bindings. Let bindings must be called as
  though they were functions with no arguments to avoid an ambiguity
  with a literal string (we have no symbols in JSON).

* Functions which are UUIDs without a template definition represent base
  permission grants. These should be called with one argument, the
  target of the permission, which should be a base value.

* Indexing operations accept one or more string parameters and index
  into the object. Keys which don't exist return `null` immediately.

* The top-level of a function definition is an array. The first element
  is another array naming the parameters. Subsequent elements are the
  result list. Where the result of evaluating a result list element is
  itself a list, this is flattened into the function result.

### Examples

Notation:

  ∈           Group membership
  ⊂           Group subset
  →           Permission template definition
  u:[]        Permission grant
  u:<t i>     Identity
  ⇒           Permission expansion

Titlecase strings represent UUIDs. Lowercase strings represent JSON
strings. JSON arrays are represented without commas. JSON objects allow
trailing commas. For example, this

    [ReadConfig {app: Address, obj: ConfigDB}]

represents this JSON

    [
      "4a339562-cd57-408d-9d1a-6529a383ea4b",
      {   
        "app": "8e32801b-f35a-4cbf-a5c3-2af64d3debd7",
        "obj": "36861e8d-9152-40c4-8f08-f51c2d7e3c25"
      }
    ]

Each example builds on the others. Comments start with `#`. Object
contents are abbreviated where there is a lot of repetition.

#### Sparkplug Node publishing

    # Template definitions
    ReadOwnConfig → [[app]
      [ReadConfig: { app: [app], obj: [principal] }]]

    SpTopic → [[addr]
      [if [has [addr] device] 
        [format "spBv1.0/%s/N%s/%s" 
          [addr group] [addr type] [addr node]]
        [format "spBv1.0/%s/D%s/%s" 
          [addr group] [addr type] [addr node] [addr device]]]]
    ParticipateAsNode → [[]
      [let [addr [id [principal] sparkplug]]
        [map t 
          [let [base [merge [addr] { type: [t] }]]
            [Publish [SpTopic [base]]]
            [Publish [SpTopic [merge [base] { device: "+" }]]]]
          "BIRTH" "DEATH" "DATA"]
        [Subscribe [SpTopic [merge [addr] { type: "CMD" }]]]
        [Subscribe [SpTopic [merge [addr] { type: "CMD", device: "+" }]]]]]

    # Groups and identities
    ConfigDB ∈ SparkplugNode
    EdgeAgent ⊂ SparkplugNode
    Node ∈ EdgeAgent
    Node:<sparkplug { group: "Group", node: "Node" }>

    # ACEs and their eventual expansion

    # This is just an example. This ACE would not be needed as Sparkplug
    # identity is now in the Auth service. A principal can always read
    # their own identities.

    SparkplugNode:[ReadOwnConfig Address]
    ⇒ ConfigDB:[ReadOwnConfig Address]
      Node:[ReadOwnConfig Address]

      # These are 'base permission' entries
    ⇒ ConfigDB:[ReadConfig {app: Address, obj: ConfigDB}]
      Node:[ReadConfig { app: Address, obj: Node }]

    Node:[ParticipateAsNode]
    ⇒ [map t 
        [list
          [Publish [SpTopic [merge {g:n:} {type:[t]}]]]
          [Publish [SpTopic [merge {g:n:} {type:[t],device:"+"}]]]]
        "BIRTH", "DEATH", "DATA"]
      [Subscribe [SpTopic [merge {g:n:} {type:"CMD"}]]]
      [Subscribe [SpTopic [merge {g:n:} {type:"CMD",device:"+"}]]]

    ⇒ [Publish [SpTopic {g: n: type: "BIRTH"}]]
      [Publish [SpTopic {g: n: type: "DEATH"}]]
      [Publish [SpTopic {g: n: type: "DATA"}]]
      [Publish [SpTopic {g: n: type: "BIRTH", device: +}]]
      [Publish [SpTopic {g: n: type: "DEATH", device: +}]]
      [Publish [SpTopic {g: n: type: "CMD", device: +}]]
      [Subscribe [SpTopic {g: n: type: "CMD"}]]
      [Subscribe [SpTopic {g: n: type: "DATA", device: +}]]

      # Under this system we can expand all the way out to the topic
      # ACLs the MQTT broker actually wants.
    ⇒ [Publish "spBv1.0/Group/NBIRTH/Node"]
      [Publish "spBv1.0/Group/NDEATH/Node"]
      [Publish "spBv1.0/Group/NDATA/Node"]
      [Subscribe "spBv1.0/Group/NCMD/Node"]
      [Publish "spBv1.0/Group/DBIRTH/Node/+"]
      [Publish "spBv1.0/Group/DDEATH/Node/+"]
      [Publish "spBv1.0/Group/DDATA/Node/+"]
      [Subscribe "spBv1.0/Group/DCMD/Node/+"]

#### Consuming Sparkplug data

    ReadAddress → [[addr]
      [map t [Subscribe [SpTopic [merge [addr] { type: [t] }]]]
        "BIRTH" "DEATH" "DATA"]]

    # We can be more specific with CCL ACEs
    Rebirth → [[addr]
      [SendCmd {
        address: [addr],
        name: [if [has [addr] device]
          "Device Control/Rebirth" "Node Control/Rebirth],
        type: "Boolean",
        value: true,
      }]]

    ConsumeNode → [[node]
      [let [addr [id [node] sparkplug]]
        [map a [list [ReadAddress [a]] [Rebirth [a]]]
          [addr] 
          [merge [addr] { device: "+" }]]]]
    ConsumeAddress → [[addr]
      [ReadAddress [a]]
      [Rebirth [a]]]

    ConfigDB:<sparkplug { group: "Core", node: "ConfigDB" }>

    # A permission template expanding to permissions for more than one
    # service.
    ClusterManager:[ConsumeNode ConfigDB]
    ⇒ [map a [list [ReadAddress [a]] [Rebirth [a]]]
        { g: n: }
        [merge {g: n:} {device: "+"}]]

    ⇒ [ReadAddress {g: n:}]
      [Rebirth {g: n:}]
      [ReadAddress {g: n: d:+}]
      [Rebirth {g: n: d:+}]

    ⇒ [Subscribe "spBv1.0/Core/NBIRTH/ConfigDB"]
      [Subscribe "spBv1.0/Core/NDEATH/ConfigDB"]
      [Subscribe "spBv1.0/Core/NDATA/ConfigDB"]
      [SendCmd { address: {g: n:}, name: "NC/R", t: v: }]
      [Subscribe "spBv1.0/Core/DBIRTH/ConfigDB/+"]
      [Subscribe "spBv1.0/Core/DDEATH/ConfigDB/+"]
      [Subscribe "spBv1.0/Core/DDATA/ConfigDB/+"]
      [SendCmd { address: {g: n: d:+}, name: "DC/R", t: v: }]

    # The administrator permissions would need reexamining; blindly
    # applying whole permission groups to wildcard is unlikely to work.
    # This example assumes cmdesc treats missing keys in the target as
    # indicating wildcards, and accepts MQTT wildcards in the address.
    Administrators:[SendCmd { address: {g:+ n:+ d:#} }]
    Administrators ⊂ GlobalDebuggers
    GlobalDebuggers:[Subscribe "spBv1.0/#"]
      :[Rebirth {g:+ n:+}]
      :[Rebirth {g:+ n:+ d:+}]

#### Improvements for Auth ACLs

This assumes that we create Sparkplug identities for edge clusters in
the Auth service. This doesn't quite add up as clusters are not
principals, but this is definitely auth information. 

This also assumes the Auth service can optionally store an 'owner' for
each object, and that the ConfigDB sets the owner to the creator when an
object is created. ACEs concerning ownership must be explicitly
implemented by the consuming service. Expanding an explicit list of
objects into an ACL returned from the Auth service and cached would
quickly become stale.

A Special UUID, `Mine`, matches any object owned by the requesting
principal. This is treated as a group, so here the base permissions must
be expecting groups, and expecting to expand them.

    KkForCluster → [[cluster]
      [CreateObject { class: EdgeAccount, uuid: false }]
      [ReadConfig { app: Info, obj: Mine }]
      [WriteConfig { app: Info, obj: Mine }]
      [ReadIdentity { uuid: Mine }]
      [let [group [[id [cluster] sparkplug] group]]
        [WriteIdentity { uuid: Mine, sparkplug: {group: [group]} }]
        [WriteIdentity { uuid: Mine, kerberos: [format "*/%s@REALM", [group]] }]
        [WriteIdentity { uuid: Mine,
          kerberos: [format "nd1/%s/*@REALM" [group]] }]]
      [map g [ManageGroup {group: [g], member: Mine}]
        [members EdgeGroups]]
    ]

    # Note: this is not ⊂ as at present.
    EdgeAgent ∈ EdgeGroups
    EdgeSync ∈ EdgeGroups

    Cluster1:<sparkplug { group: "Cluster1" }>
    
    Cluster1KK:[KkForCluster Cluster1]
      # Some ACEs omitted
    ⇒ [WriteIdentity {uuid: Mine, sparkplug: {group: "Cluster1"}}]
      [WriteIdentity {uuid: Mine, kerberos: "*/Cluster1@REALM"}]
      [WriteIdentity {uuid: Mine, kerberos: "nd1/Cluster1/*@REALM"}]
      [ManageGroup {group: EdgeAgent, member: Mine}]
      [ManageGroup {group: EdgeSync, member: Mine}]

As opposed to the current system, this both correctly identifies the
groups which can be managed by the edge krbkeys and also limits the
members which can be placed in them. The identity restrictions also
avoid making a root-equivalent grant.

The groups changes mean it isn't any longer possible to simply grant a
permission on a group and have the grant distribute over the group
members. An explicit `map` is required, and if this is to be granted in
an ACE a template definition needs to be created to contain the `map`.
In this case a template would have been required anyway, as the
`ManageGroup` base permission now required a structured target.

#### Dynamic device requirements

A simple scheme for allowing certain Nodes to grant read access to their
Devices might look like this. This relies on a ManageACL permission
which puts limits on the contents of the target rather than simply
requiring the target to be in a group. It is also limited to direct
grants to a Node to manage its own Devices.

    DynamicNodes ⊂ SparkplugNodes

    DynamicNodes:[ManageACL {
      permission: ConsumeAddress,
      target: {
        group:  [[id [principal] sparkplug] group],
        node: [[id [principal] sparkplug] node]
      }]

A more general scheme for allowing dynamic ACLs on Devices relies on
ownership. In general an 'ordinary' Device published by a Node will need
to be created in the services by the Directory. This means the Directory
will need to be able to chown the Device to the Node which originally
published it. It also means there will be a delay before the Node is
authorised to set permissions on a new Device.

This scheme unavoidably depends on Directory lookups to make
authorisation decisions. The only alternative would be for the Directory
to store the current location of every Device in the Auth service, but I
don't think that's a good idea.

    GiveToGroup → [[group]
      [map m [ChangeOwner { from: [principal], to: [m] }]
        [members [group]]]]
    OwnGrant → [[permissions]
      [map perm [ManageACL { permission: [perm], target: Mine }]
        [members [permissions]]]]

    DeviceAddress → [[device]
      [let [info [lookup DirectorySvc "v1/device/" [device]]]]
        { group:  [[info] "group_id"],
          node: [[info] "node_id"],
          device: [[info] "device_id"]
        }]
    ConsumeDevice → [[device]
      [ConsumeAddress [DeviceAddress [device]]]]

    SparkplugNodes:[PublishDevice Mine]
    SparkplugNodes:[PublishNewDevice]
    Directory:[GiveToGroup SparkplugNodes]
    
    DynamicNodes ⊂ SparkplugNodes
    DynamicNodes:[OwnGrant ConsumeDevice]

Here `lookup` is a new builtin which performs a Factory+ Service API
call. It takes three parameters: a service function UUID, a path, and
(optionally) an object ID relative to that path. The form with separate
object ID should only be used for services supporting
[../acs-rendezvous/docs/notify-v1.md](the new notify-v1 interface) and
which allow the base path to be used as a channel URL.

vi:set sts=2 sw=2:

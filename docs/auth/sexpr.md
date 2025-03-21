# S-expression based permission templates

This is a proposal for an Auth service redesign based on defining
permission templates to replace the current concept of 'roles'. The
intent of these was to allow multiple permissions to be granted
simultaneously (for example: MQTT subscribe and Cmdesc Rebirth), but the
model is not flexible enough as all permissions in the role are applied
to a single target. In addition, both MQTT and Cmdesc have implemented
ad-hoc template expansions based on ConfigDB entries; these are
generalised into a template language defined in S-expressions (LISP data
structures) expressed as JSON arrays.

## Data structure

### Identity and ownership

* Sparkplug Nodes are principals; their Sparkplug address information is
  moved into the Auth service to sit alongside the Kerberos identity as
  an alternative name.

* Currently the design is that Sparkplug Devices are still assigned
  their names and UUIDs by the Node. Finding a Device address means a
  request to the Directory. Authorisation for Directory indexing is
  still an open question.

* Objects in the ConfigDB have an 'owner' property. This will be exposed
  as part of the _Object registration_ config entries. Objects are
  initially assigned the ownership of the principal who created them;
  permissions will be needed to allow for ownership transfer.

### Auth groups and ConfigDB classes

* Auth groups are removed and replaced with ConfigDB classes. These are
  extended to support subclasses and classes-of-classes, as distinct
  concepts from each other, and to any depth.

* Multiple classification and multiple inheritance are supported. (When
  expressed in terms of 'groups' they are both obviously necessary.) We
  will need to establish a sensible classification structure, and
  probably some concept of 'primary class for an object' for human
  display purposes.

* In the long term some form of restriction or validation of the members
  of a class would be a good idea; in particular an assertion that
  certain classes must remain distinct. Derived classes (whether from
  set operations on other classes or from config property filters) are
  also an interesting possibility. Neither are specified at this point.

* The 'members of a class' are determined as follows. A UUID which is
  not recorded as being a class has no members. A class UUID records a
  set of direct members, and a set of direct subclasses. All direct
  members are included. To these are added all members of all
  subclasses, recursively. The UUIDs of the class and subclasses
  themselves are not included as members.

### Permission grants

* A permission grant has the form `[principal, permission,
  ...arguments]`. There may be zero or more arguments. Principal and
  permission must both be UUIDs; the arguments must be objects, strings
  or `null`.

* The principal of an ACE is a UUID, which can represent either an
  individual principal or a class. A given UUID can be valid either as
  an individual principal, or as a class of principals, but not both.
  These possibilities are identified by the UUID being a member of one
  of two well-known classes. A grant to an individual applies to that
  principal only, even if that principal is itself a class. A grant to a
  class applies to all members of that class.

* The permission of an ACE is always a UUID. There are two categories of
  permission: base permissions which are returned to the requesting
  service, and permission templates. These are identified by being
  members of distinct well-known classes. Template permissions have a
  template definition in the ConfigDB, and will be fully expanded by the
  Auth service; templates will never be returned to a requesting
  service.

* The arguments of an ACE are JSON values, which must be either objects,
  strings or `null`. (Arrays are reserved to represent template calls
  internally.) In some cases a string will represent a UUID but this is
  up to the service to interpret. Wildcards and class expansion are also
  up to the service; when a service defines its permissions it must be
  explicit about whether a UUID is interpreted as an individual or a
  class, and how wildcards apply.

A permission grant using a template permission is evaluated as though it
were the expression `[template ...arguments]`. The resulting list will
only contain base permissions and 

## Template evaluation

In this section the following notation conventions are used:

* JSON arrays are referred to as 'lists', and are written without
  commas.

* An unquoted string is a syntax variable; this represents a single JSON
  value.

* The notation `...values` within a list indicates zero or more JSON
  values.

### Evaluation

When a JSON value is 'evaluated', these rules are applied. To
'list-evaluate' a list means to evaluate each element and create a list
of the resulting values. Values marked below as '(Scalar)' will be
included in the result list directly; values marked '(List)' will be
concatenated onto the result list.

Evaluation always occurs in relation to a set of bindings, which is a
map from strings to values. Evaluation is eager: a bound value is
already fully evaluated, and will not be evaluated again. Unless
otherwise specified any recursive evaluation is against the same set of
bindings; `let`, `map` and template calls change the bindings.

* A `null`, boolean, number or string evaluates to itself. (Scalar)

* An object evaluates to an object with the same keys as the evaluated
  object, where each corresponding value has been evaluated. (Scalar)

* An empty list evaluates to an empty list. (List)

* Any other list represents a function call; the first member of the
  list names the item to call. This must be a string and it names a
  builtin, a binding, a base permission or a permission template.

* Certain strings name builtins; these are listed below. Some builtins
  start by evaluating all their arguments like other calls, but others
  have special evaluation rules; these are also described below.

* Other calls always begin by list-evaluating the remaining members of
  the call list. The evaluated list forms the arguments to the call.

* A call naming a current binding with no arguments evaluates to the
  value of that binding. Bindings must be called, unlike in LISP, to
  avoid an ambiguity with a literal string; we have no symbols in JSON.
  (List)

* A call naming a current binding with arguments requires that the value
  of the binding is an object or `null`. Each argument represents a key
  to look up; a nonexistent key or `null` value at any point terminates
  the process and evaluates to `null`. (Scalar)

* Base permissions are named by UUIDs which are members of the _Base
  permission_ well-known class. A call to a base permission returns a
  JSON array `[perm ...arguments]`, but note the arguments have been
  evaluated. (Scalar)

* Templates are named by UUIDs which are members of the _Permission
  template_ well-known class and have a _Permission template definition_ 
  ConfigDB entry. Bindings are created for the template parameters from
  the argument list, and the results list is list-evaluated using (only)
  these bindings and returned. (List)

* Other calls evaluate as though they were an appropriate call to the
  `throw` builtin.

Note that the name of a call is not evaluated and must be specified as a
literal string. There is no dynamic-call facility. The language has no
lambdas and no first-class functions so the loss of flexibility is
minor, and the restriction enables useful static analysis.

### Builtins

Builtins are all named by short, lowercase strings. Builtins fall into
two categories: those which evaluate and flatten their arguments as
though they were normal template calls with outside sources of
information, and 'special forms' which evaluate their arguments
differently.

Special forms are denoted (*) below; these must be explicitly in the
form documented, before evaluation. The notes '(Scalar)' and '(List)'
mean the same as above.

* `equal`: `["equal" a b]`. This performs deep equality testing on two
  JSON values. Returns `true` or `false`. (Scalar)

* `flat`: `["flat" list]`. Given a list value which has not already been
  flattened, e.g. from `list` or `quote` or `lookup`, return the list
  such that it will flatten into a return list. (List)

* `format`: `["format" str ...args]`. Performs sprintf formatting using
  Node's `util.format`.

* `has`: `["has" obj key]`. Expects the first argument to be an object
  and the second to be a string. Returns `true` if the object has the
  named key, `false` otherwise. (Scalar)

* `id`: `["id" principal type]`. Looks up identity details for the given
  principal. The type can be `kerberos` or `sparkplug`.

* `if` (*): `["if" cond pass]` or `["if" cond pass fail]`. Both forms
  start by evaluating the condition. If this results in the empty list,
  or if the first item is `null` or `false`, we evaluate the `fail`
  value, or return the empty list. Otherwise we evaluate the `pass`
  value. (List)

* `let` (*): `["let" bindings ...body]`. The `bindings` must be a list
  with an even number of items; odd numbered items must be strings and
  name new bindings. Each is followed by a value. A new set of bindings
  is constructed starting from the current set. The first value is
  evaluated using the current bindings and a binding for the first name
  is added with the result. Each subsequent value is evaluated using the
  new bindings and added to the set. Finally `body` is list-evaluated
  using the new bindings and the result returned. (List)

* `list`: Returns its arguments (after evaluation). This is the only way
  to construct a JSON array in a result list. (Scalar)

* `lookup`: `["lookup" service prefix key]`. This performs a lookup on a
  F+ service and returns the result. (Scalar)

* `map` (*): `["map" [bind ...body] ...list]`. Map starts by
  list-evaluating `list`, using the current bindings. Then, for each
  element in the result, a new set of bindings is created with that
  element bound to `bind`. The `body` is list-evaluated against each set
  of bindings and the results concatenated and returned. (List)

* `merge`: `["merge" ...objs]`. Merge the properties of all objects,
  with values from later objects overwriting those from earlier objects.
  (Scalar)

* `principal`: `["principal"]`. Returns the UUID of the principal to
  whom this ACE applies. (Scalar)

* `quote` (*): `["quote" value]`. Returns its value unchanged and
  unevaluated. (Scalar)

### Template definitions

A permission template is a function which accepts zero or more arguments
and returns a list of permission grants. When ACLs are looked up all
permission templates are expanded recursively and the result included in
the list of ACEs returned. Some form of recursion control will obviously
be necessary.

If a template is called with too many arguments additional arguments are
ignored. If a template is called with too few arguments the additional
parameters are bound to `null`.

A template definition is represented in JSON as an S-expression built
from lists (i.e. arrays) and strings. The top level of the definition
must be a list of the form `[[...params] ...results]`. The first
element is a list of parameter names; these must be strings, and when
the template is called the arguments will be bound to the parameters as
though via `let`. The remainder of the definition forms the result list;
each item will be evaluated and the result flattened into the template's
return list.

## Examples

Notation:

    ∈           Class membership
    ⊂           Class subset
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

### Sparkplug Node publishing

    # Template definitions
    ReadOwnConfig → [[app]
      [ReadConfig: { app: [app], obj: [principal] }]]

    SpTopic → [[type addr]
      [if [has [addr] device] 
        [format "spBv1.0/%s/N%s/%s" [addr group] [type] [addr node]]
        [format "spBv1.0/%s/D%s/%s" 
          [addr group] [type] [addr node] [addr device]]]]
    ParticipateAsNode → [[]
      [let [node [id [principal] sparkplug]]
        [map [addr
            [Publish [SpTopic "BIRTH" [addr]]]
            [Publish [SpTopic "DATA" [addr]]]
            [Publish [SpTopic "DEATH" [addr]]]
            [Subscribe [SpTopic "CMD" [addr]]]]
          [node]
          [merge [node] { device: "+" }]]]]

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
    ⇒ [map [addr
          [Publish [SpTopic "BIRTH" [addr]]]
          [Publish [SpTopic "DATA" [addr]]]
          [Publish [SpTopic "DEATH" [addr]]]
          [Subscribe [SpTopic "CMD" [addr]]]]
        { group: "Group", node: "Node" }
        [merge { group: "Group", node: "Node" } { device: "+" }]]

    ⇒ [map [addr
          [Publish [SpTopic "BIRTH" [addr]]]
          [Publish [SpTopic "DATA" [addr]]]
          [Publish [SpTopic "DEATH" [addr]]]
          [Subscribe [SpTopic "CMD" [addr]]]]
        { group: "Group", node: "Node" }
        { group: "Group", node: "Node", device: "+" }]

    ⇒ [Publish [SpTopic "BIRTH" {g: n:}]]
      [Publish [SpTopic "DATA" {g: n:}]]
      [Publish [SpTopic "DEATH" {g: n:}]]
      [Subscribe [SpTopic "CMD" {g: n:}]]
      [Publish [SpTopic "BIRTH" {g: n: d: +}]]
      [Publish [SpTopic "DATA" {g: n: d: +}]]
      [Publish [SpTopic "DEATH" {g: n: d: +}]]
      [Subscribe [SpTopic "CMD" {g: n: d: +}]]

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

### Consuming Sparkplug data

    ReadAddress → [[addr]
      [map [t
          [Subscribe [SpTopic [merge [addr] { type: [t] }]]]]
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
        [map [a [ReadAddress [a]] [Rebirth [a]]]
          [addr]
          [merge [addr] { device: "+" }]]]]
    ConsumeAddress → [[addr]
      [ReadAddress [a]]
      [Rebirth [a]]]

    ConfigDB:<sparkplug { group: "Core", node: "ConfigDB" }>

    # A permission template expanding to permissions for more than one
    # service.
    ClusterManager:[ConsumeNode ConfigDB]
    ⇒ [map [a [ReadAddress [a]] [Rebirth [a]]]
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

### Improvements for Auth ACLs

This assumes that we create Sparkplug identities for edge clusters in
the Auth service. This doesn't quite add up as clusters are not
principals, but this is definitely auth information. (Alternatively all
the naming, Kerberos as well as Sparkplug, moves to the ConfigDB.)

A Special UUID, `Mine`, matches any object owned by the requesting
principal. This is treated as a group, so here the base permissions must
be expecting groups, and expecting to expand them. (_XXX_ Can this be
replaced with a `map` over an ownership lookup?) 

    KkForCluster → [[cluster]
      [CreateObject { class: EdgeAccount, uuid: false }]
      [ReadConfig { app: Info, obj: Mine }]
      [WriteConfig { app: Info, obj: Mine }]
      [ReadIdentity { uuid: Mine }]
      [let [addr [id [cluster] sparkplug]
            group [addr group]]
        [WriteIdentity { uuid: Mine, sparkplug: {group: [group]} }]
        [WriteIdentity { uuid: Mine, kerberos: [format "*/%s@REALM", [group]] }]
        [WriteIdentity { uuid: Mine,
          kerberos: [format "nd1/%s/*@REALM" [group]] }]]
      [map [g [ManageGroup {group: [g], member: Mine}]]
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

### Change-notify Devices

A simple scheme for allowing certain Nodes to grant read access to their
Devices might look like this. This is limited to direct grants to a Node
to manage its own Devices. (This use-case is no longer required with the
v2 change-notify spec but demonstrates what is possible.)

This also relies on a ManageACL permission which puts limits on the
contents of the target rather than simply requiring the target to be in
a group; given the general nature of targets under this design it's not
clear how this would work in general. One possibility might be: perform
a JSON merge patch of the template onto the proposed target; if the
result changes then the test fails.

    DynamicNodes ⊂ SparkplugNodes

    ManageMyConsumers → [[]
      [let [addr [id [principal] sparkplug]]
        [ManageACL {
          permission: ConsumeAddress,
          target: { group: [addr group], node: [addr node] }]]]

    DynamicNodes:[ManageMyConsumers]

### Dynamic deployment

A more general scheme for allowing dynamic ACLs on Devices relies on
ownership. In general an 'ordinary' Device published by a Node will need
to be created in the services by the Directory. This means the Directory
will need to be able to chown the Device to the Node which originally
published it. It also means there will be a delay before the Node is
authorised to set permissions on a new Device.

(_XXX_ Can all this be avoided by dropping the concept that Nodes can
publish any Devices and assign them UUIDs, and requiring Device
addresses to be pre-registered? This makes mobile Devices more
difficult, but that is a concept we've never tried to make use of, and
I'm not now sure that mobile instances wouldn't be a better concept.)

This scheme unavoidably depends on Directory lookups to make
authorisation decisions. In this case the Directory lookup will need to
be performed by the MQTT broker, and the broker will need to use
change-notify to track changes to the Device address. One important
disadvantage here is that if a Device changes address there will be a
delay before the ACLs change. 

    GiveToGroup → [[group]
      [map [m [ChangeOwner { from: [principal], to: [m] }]]
        [members [group]]]]

    DeviceAddress → [[device]
      [let [info [lookup DirectorySvc "v1/device/" [device]]]
        [if [has [info] "device_id"]
          { group:  [info "group_id"],
            node:   [info "node_id"],
            device: [info "device_id"],
          }
          { group:  [info "group_id"],
            node:   [info "node_id"],
          }]]
    ConsumeDevice → [[device]
      [ConsumeAddress [DeviceAddress [device]]]]

    SparkplugNodes:[PublishDevice Mine]
    SparkplugNodes:[PublishNewDevice]
    Directory:[GiveToGroup SparkplugNodes]
    
    DynamicNodes ⊂ SparkplugNodes
    DynamicNodes:[ManageACL {
      principal: SparkplugConsumers,
      permission: ConsumeDevice,
      target: Mine }]

This version of ManageACL expects a group for each of principal,
permission, target. As usual the permission entry `ConsumeDevice`, which
is not a group, is expanded by `members` as a singleton group.

Here `lookup` is a builtin which performs a Factory+ Service API
call. It takes three parameters: a service function UUID, a path, and
(optionally) an object ID relative to that path. Where the consuming
service has subscribed to change-notify for its ACLs the Auth service
will need to subscribe to the appropriate external services.

This definition of `DeviceAddress` needs to reformat the address into
the (now-)standard form we are using for Sparkplug addresses. A
modification to the Directory API would allow this to be written as
something this instead:

    DeviceAddress → [[device]
      [lookup DirectorySvc "v1/device/address/" [device]]]

vi:set sts=2 sw=2:

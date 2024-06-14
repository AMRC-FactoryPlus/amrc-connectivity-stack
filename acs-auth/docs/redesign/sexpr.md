# S-expression based permission templates

This is a proposal for an Auth service redesign based on s-expressions
expressed as JSON arrays.

* Groups can only be used for principals or targets (nouns). Groups of
  permissions are no longer expanded.

* The function `members` expands the members of a group. Expanding a
  UUID which does not represent a group returns a singleton list.

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

## Permission templates

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
  names the function to call. This must be a string and it names a
  builtin, a `let` binding, or a permission UUID.

* Certain strings name builtins. These are: `list`, `let`, `merge`,
  `if`, `get`, `has`, `equal`, `map`, `join`, `format`, `members`,
  `principal`, `id`, `lookup`.

* Let bindings are created with the `let` builtin and are only available
  over the scope of the call to `let`. Function arguments are available
  as though they were `let` bindings. Let bindings must be called as
  though they were functions with no arguments to avoid an ambiguity
  with a literal string (we have no symbols in JSON).

* Functions which are UUIDs without a template definition represent base
  permission grants. These should be called with one argument, the
  target of the permission, which should be a base value.

* The top-level of a function definition is an array. The first element
  is another array naming the parameters. Subsequent elements are the
  result list. Where the result of evaluating a result list element is
  itself a list, this is flattened into the function result.

## Examples

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

### Sparkplug Node publishing

    # Template definitions
    ReadOwnConfig → [[app]
      [ReadConfig: { app: [app], obj: [principal] }]]

    SpTopic → [[type addr]
      [if [has [addr] device] 
        [format "spBv1.0/%s/N%s/%s" 
          [get [addr] group] [type] [get [addr] node]]
        [format "spBv1.0/%s/D%s/%s" 
          [get [addr] group] [type] [get [addr] node] [get [addr] device]]]]
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
      [let [group [get [id [cluster] sparkplug] group]]
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
to manage its own Devices.

This also relies on a ManageACL permission which puts limits on the
contents of the target rather than simply requiring the target to be in
a group; given the general nature of targets under this design it's not
clear how this would work in general. One possibility might be: perform
a JSON merge patch of the template onto the proposed target; if the
result changes then the test fails.

    DynamicNodes ⊂ SparkplugNodes

    DynamicNodes:[ManageACL {
      permission: ConsumeAddress,
      target: {
        group:  [get [id [principal] sparkplug] group],
        node: [get [id [principal] sparkplug] node]
      }]

### Dynamic deployment

A more general scheme for allowing dynamic ACLs on Devices relies on
ownership. In general an 'ordinary' Device published by a Node will need
to be created in the services by the Directory. This means the Directory
will need to be able to chown the Device to the Node which originally
published it. It also means there will be a delay before the Node is
authorised to set permissions on a new Device.

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
          { group:  [get [info] "group_id"],
            node:   [get [info] "node_id"],
            device: [get [info] "device_id"],
          }
          { group:  [get [info] "group_id"],
            node:   [get [info] "node_id"],
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

Here `lookup` is a new builtin which performs a Factory+ Service API
call. It takes three parameters: a service function UUID, a path, and
(optionally) an object ID relative to that path. The form with separate
object ID should only be used for services supporting
[../acs-rendezvous/docs/notify-v1.md](the new notify-v1 interface) and
which allow the base path to be used as a channel URL.

This definition of `DeviceAddress` results in a lot of deferred
evaluation, as the `[if]` depends on the result from the Directory. If
we adjust the Directory API to return what we need directly we can use a
direct call:

    DeviceAddress → [[device]
      [lookup DirectorySvc "v1/device/address/" [device]]]

which does not result in so much work being deferred to the consuming
service.

vi:set sts=2 sw=2:

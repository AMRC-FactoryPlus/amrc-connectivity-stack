# Dynamic groups Auth proposal

This is an Auth service redesign proposal intended not to extend the
existing systems any further than is needed. The extensions to the
current data model are:

* Node Sparkplug addresses live in the Auth service as another principal
  identity. Cluster Sparkplug groups will need to live here too.

* The Auth service will need to provide change-notify.

* Static groups are defined in the Auth database as currently. These
  groups now distinguish member-of and subset-of.

* ACE targets are extended to be arbitrary JSON objects. The
  interpretation of the contents is now up to the consuming service, so
  it isn't possible for group UUIDs in the target to be expanded by the
  Auth service.

* Objects have ownership, tracked in the Auth service. Permissions here
  are ClaimObject and ChangeOwner. _Mine_ is a dynamic group containing
  all objects owned by the requesting client. The existing _Wildcard_ 
  and _Self_ Special UUIDs are also considered to be dynamic groups,
  though they will almost certainly be special-cased in any consuming
  service.

## Examples

The current services will continue to run mostly the same. Clients that
look up Sparkplug addresses for Nodes will need to contact the Auth
service; the JS ServiceClient already handles this transparently. If
these addresses are not proxied through the ConfigDB then the MQTT
broker would need modifying to contact the Auth service where needed.

Notation:

    ∈       Static group membership
    ⊂       Static group subgroup
    G:{}    Dynamic group definition
    U:<t i> Identity
    [U P T] ACE

Titlecase strings represent UUIDs. Comments begin with `#`.

### Edge krbkeys

    EdgeAgent ∈ EdgeGroups
    EdgeSync ∈ EdgeGroups

    Cluster1:<sparkplug { group: "Cluster1" }>
    Cluster1KK ∈ EdgeKK
    Cluster1Flux ∈ EdgeFlux

    # These can be granted generically on the groups of operators.
    [EdgeKK CreateObject { class: EdgeAccount, uuid: false }]
    [EdgeKK ReadConfig { app: Info, obj: Mine }]
    [EdgeKK WriteConfig { app: Info, obj: Mine }]
    [EdgeKK ReadIdentity { uuid: Mine }]
    [EdgeKK ManageGroup { groups: EdgeGroups, members: Mine }]
    [EdgeFlux GitPull SharedRepos]
    
    # These must be granted specifically per cluster.
    [Cluster1KK WriteIdentity { uuid: Mine, sparkplug: { group: "Cluster1" } }]
    [Cluster1KK WriteIdentity { uuid: Mine, kerberos: "*/Cluster1@R" }]
    [Cluster1KK WriteIdentity { uuid: Mine, kerberos: "nd1/Cluster1/*@R" }]
    [EdgeFlux GitPull Cluster1Repo]

The list of permissions that must be granted specifically to each edge
krbkeys operator is very specific. Changing this list would mean
changing the cluster manager, and unless it was written to reconcile
permissions, clusters which were already deployed would not be updated
to the new permission structure. In this particular case this could be
worked around in the Auth service in at least two different ways:

    # Specify the cluster target explicitly
    [Cluster1KK WriteClusterIdentity { uuid: Mine, cluster: Cluster1 }]

    # Implicitly grant permission on 'my' cluster. This would mean
    # krbkeys would need a Sparkplug identity to get the group.
    [EdgeKK WriteClusterIdentity { uuid: Mine }]

but this embeds assumptions about the V3 edge cluster configuration into
the Auth service.
    
### Dynamic deployment

Because we don't have any form of template expansion it isn't possible
to implement 'grant permission to Devices under my Node' directly as we
could with the sexpr proposal. Obviously a specific permission
implemented in the Auth service would be a possibility but this rather
destroys the concept of a generic authorisation service.

Applying the 'ownership' concept, and assuming the Directory is set up
to create objects for new Devices and transfer their ownership to the
Node, we get something like this:

    EdgeAgents ⊂ SparkplugNodes
    DynamicNodes ⊂ SparkplugNodes

    EdgeAgent1 ∈ EdgeAgents
    Directory ∈ DynamicNodes
    ConfigDB ∈ DynamicNodes

    Directory ∈ SparkplugConsumers
    ClusterManager ∈ SparkplugConsumers

    [ConfigDB ClaimObject Wildcard]
    [ConfigDB ChangeOwner { from: ConfigDB, to: Wildcard }]
    [Directory CreateObject { class: SparkplugDevice, uuid: true }]
    [Directory ChangeOwner { from: Directory, to: SparkplugNodes }]

    # These are Directory permissions controlling indexing of the
    # Device. They do not affect MQTT ACLs.
    [SparkplugNodes PublishDevice Mine]
    [SparkplugNodes PublishNewDevice]

    # This is an MQTT permission with a ConfigDB definition.
    ReadDevice ∈ ConsumeDevice
    # This is the existing CCL with a ConfigDB definition.
    Rebirth ∈ ConsumeDevice

    ConsumeDevice ∈ DynamicPermissions

    [DynamicNodes ManageACL {
        principal: SparkplugConsumers,
        permission: DynamicPermissions,
        target: Mine,
    }]
    
The ownership tracking is quite complicated due to the different
services interacting:

* When EdgeAgent1 publishes a new Device the Directory picks this up and
  attempts to register the Device UUID with the ConfigDB.

* The Directory has `CreateObject`, a ConfigDB permission. In this case
  this allows the Directory to register a pre-existing UUID with the
  ConfigDB (rather than the ConfigDB generating and returning the UUID).

* The ConfigDB has `ClaimObject`. This is an Auth permission allowing
  the ConfigDB to create a new ownership record with itself as owner.

* The ConfigDB then reassigns ownership to the Directory, as permitted
  by its `ChangeOwner` grant.

* Once the ConfigDB has returned success, the Directory reassigns
  ownership again to EdgeAgent1.

The MQTT ReadDevice permission will need to look up via the Directory
rather than via the Auth service; this will probably mean a change in
detail to the ConfigDB permission template format. The plugin will also
need to track changes, including keeping track of which changes we care
about and which clients they will affect. An alternative would be to
proxy both data sources through the ConfigDB, but then: how do we do
change-notify, how do we handle etags, and what do we do if both
services give different answers?.

I am here assuming the ManageACL permission accepts a group for each
property and allows grants to any combinations of the members of those
groups. Since we want to allow a grant of `ConsumeDevice` only, not a
grant of the individual components, this means we need
`DynamicPermissions` to provide a layer of quoting.

### Initial object creation

The chain of actions taking place when a new Device is registered only
involves the ConfigDB as the central UUID registry. Given that the
Device UUID doesn't have anything recorded against it (yet), maybe the
master list of known UUIDs moves into the Auth service and the Directory
creates the object directly there. 

In this case I think the Auth groups should be considered to subsume and
replace the ConfigDB classes. This has the disadvantage of losing the
ability to display a 'primary classification' to users. Maybe that moves
into General Info, as user-visible rather than machine-usable
information?

    # This is group quoting as before.
    SparkplugDevices ∈ DirectoryManagedGroups

    # The boolean here indicates whether arbitrary (nonexistent) UUIDs
    # can be claimed. 
    [Directory ClaimObject true]
    [Directory ManageGroup { groups: DirectoryManagedGroups, members: Mine }]
    [Directory ChangeOwner { from: Self, to: SparkplugNodes }]    

In this situation the Directory's ownership has a purpose, as it allows
the Directory to set the SparkplugDevice group membership. The ConfigDB
is not involved.

Of course, normally Edge Agents have their Device UUIDs assigned by the
Manager. This is similar to the use case requirement here for dynamic
devices created by a reconciliation service. This now looks more like

    EdgeAgents ⊂ SparkplugNodes
    DynamicNodes ⊂ SparkplugNodes

    # Users can (where permitted) deploy Devices on their own account.
    me1xxx ∈ DeploymentUsers
    SparkplugDevices ∈ DeploymentGroups

    # The Manager can generate new UUIDs, but can't choose what they
    # are. It must use the UUIDs it's given.
    [DeploymentUsers ClaimObject false]
    [DeploymentUsers ManageGroup { groups: DeploymentGroups, members: Mine }]
    [DeploymentUsers ManageACL {
        principal: EdgeAgents,
        permission: PublishDevice,
        target: Mine
    }]

    [DynamicNodes PublishNewDevice]

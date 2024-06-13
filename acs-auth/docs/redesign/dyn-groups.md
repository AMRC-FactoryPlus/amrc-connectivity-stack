# Dynamic groups Auth proposal

This is an Auth service redesign proposal intended not to extend the
existing systems any further than is needed. The extensions to the
current data model are:

* Node Sparkplug addresses live in the Auth service as another principal
  identity. Cluster Sparkplug groups will need to live here too.

* The Auth service will need to provide change-notify.

* Static groups are defined in the Auth database as currently. These
  groups now distinguish member-of and subset-of.

* Dynamic groups are defined in terms of API requests to external
  services. 

* Objects have ownership, tracked in the Auth service. Permissions here
  are ClaimObject and ChangeOwner. 

## Dynamic groups

## Examples

The current services will continue to run mostly the same. Clients that
look up Sparkplug addresses for Nodes will need to contact the Auth
service; the JS ServiceClient already handles this transparently.

Notation:

    ∈       Static group membership
    ⊂       Static group subgroup
    G: {}   Dynamic group definition
    [U P T] ACE

### Edge krbkeys



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
      [map [g [ManageGroup {group: [g], member: Mine}]]
        [members EdgeGroups]]
    ]


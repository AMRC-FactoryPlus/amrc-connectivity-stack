> **Note**
> The AMRC Connectivity Stack is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk/).

This `acs-auth` service satisfies the Authorisation module component of the Factory+ framework and provides authorisation services to other Factory+ services. It provides a framework allowing unified treatment of ACL information, with all permissions editing in one place.

The authentication service primarily provides an ACL lookup function. These ACLs are expressed in terms of UUIDs in order to make the service able to support ACLs for multiple services. The meanings of those UUIDs are in general defined by the service using them.

## Data model

An ACE (access control entry) links three objects: a principal, a permission and a target. The semantics are 'this principal has this permission on this target'; i.e. the principal says 'who may do this', the permission says 'what may be done' and the target says 'what may it be done to'. In the auth service all three are represented by UUIDs.

ACEs are allow-only; there are no Deny ACEs. The permission model therefore needs to be deny-by-default. The significance of the Permission and Target UUIDs is defined by the service that makes use of the ACE. Conventionally the null UUID (all zeros) as a target is a wildcard meaning 'this permission on all targets' or 'this permission needs no target'.

In order to avoid excessive duplication, any of the three UUIDs can represent a group rather than an individual object. Groups are defined in the auth service as they must be known before any other services can be successfully contacted. Groups may contain other groups and are expanded recursively.

The auth service also holds information linking a Principal UUID to external identifiers that represent the same security object. Currently this means a Kerberos principal; it is possible to set up a 1-1 mapping between a Kerberos principal and a UUID, and to use Kerberos principal names when requesting ACL information.

*These external links may be extended in future to include other identifiers, in particular Sparkplug Node addresses.*

## Discovery and authentication

This service complies to the Factory+ framework so can therefore be discovered via the Directory. Since this service has no MQTT component service discovery will return a null Device UUID.

The UUID for the Authentication service function is

```
cab2642a-f7d9-42e5-8845-8f35affe1fd4
```

The service supports an HTTP API only. All requests must supply HTTP authentication; the following mechanisms are supported:

| Mechanism | Authentication info required                                   |
|-----------|----------------------------------------------------------------|
| Negotiate | A Kerberos GSSAPI token.                                       |
| Basic     | Username and password for a password-based Kerberos principal. |
| Bearer    | A token from the `/token` endpoint.                            |

## HTTP interface

### Service spec endpoints

#### `GET /ping`

If this succeeds it indicates that the service is alive, has been discovered correctly, and that the client has valid credentials. Returns an object with these properties:

| Property  | Value                        |
|-----------|------------------------------|
| `service` | The Auth service UUID above. |
| `version` | The software version.        |


#### `POST /token`

Returns a token to use with Bearer auth. Returns an object with these properties:

| Property | Value                                                |
|----------|------------------------------------------------------|
| `token`  | The token.                                           |
| `expiry` | The expiry date of the token, in ms since the Epoch. |

Tokens may become invalid and return 401 before the expiry date given, for instance if the service is restarted.

### ACL endpoints

#### `GET /authz/acl?{parameters}`

This is the primary endpoint for services wishing to verify client's permissions. Parameters are passed in the query string:

| Parameter    | Type    | Meaning                              |
|--------------|---------|--------------------------------------|
| `principal`  | string  | The principal to query the ACL for.  |
| `by-uuid`    | boolean | Choose format for `principal`.       |
| `permission` | uuid    | The permission (group) to query for. |

If `by-uuid` is false or omitted, `principal` is a Kerberos principal name (note this needs to be a full principal name, not just a username). If `by-uuid` is true, `principal` is a UUID.

The `permission` parameter should be a single UUID, indicating the permission queried for. Normally this will be a permission group set up to hold all the permissions a single service is interested in.

Returns an array of objects giving all permissions in the given group granted to the given principal. Each object has two keys, `permission` and `target`. All groups will have been resolved, so for example if:

* Principal K is a member of group K1.
* Permission P is a member of groups P1 and P2.
* Target T is a member of group T1.
* There is an ACE in the database (K1, P1, T1).
* A query is made `principal=K&permission=P2`.

then (P, T) will be in the result set (and none of the groups will be).

The result will have an HTTP Cache-Control header. Please ensure this is respected.

#### `GET /authz/ace`

Returns all ACEs in the database, as objects with `principal`, `permission` and `target` keys. You need wildcard Manage_ACL permission to call this.

#### `POST /authz/ace`

This is the interface to edit the ACL database. The body is an object with these properties:

| Property     | Value                 | Meaning           |
|--------------|-----------------------|-------------------|
| `action`     | `"add"` or `"delete"` | Action requested. |
| `principal`  | UUID                  | ACE principal.    |
| `permission` | UUID                  | ACE permission.   |
| `target`     | UUID                  | ACE target.       |

Currently always returns 204. When adding, if the ACE requested already exists it is silently ignored. When deleting, the ACE to be deleted must match all fields; if it is not found this is ignored.

*This interface is bad. It was only implemented to make the editor work. Something more RESTful (and with better error returns) needs to be defined instead.*

### Principal endpoints

*In future these may manage other external mappings too, e.g. Sparkplug Node mappings.*

#### `GET /principal`

Returns a list of objects `{ uuid, kerberos }` listing all the principals in the database with Kerberos mappings.

#### `POST /principal`

Accepts an object `{ uuid, kerberos }` and creates a Kerberos mapping for the principal. Returns 204 on success; if either the UUID or the Kerberos principal already has a mapping returns 409.

#### `GET /principal/{principal}`

The principal parameter should be a UUID. Returns an object `{ uuid, kerberos }` giving the Kerberos mapping of the principal.

#### `DELETE /principal/{principal}`

Delete a Kerberos mapping.

#### `GET /principal/find?kerberos={kerberos}`

Search for a principal by Kerberos principal name. Returns the UUID, if found.

#### `GET /effective`

Returns a list of all Kerberos principals in the mapping table. *This is just a convenience for the editor.*

#### `GET /effective/{kerberos}`

Fetch the effective permissions for a given Kerberos principal. This returns all permissions granted to that principal, including all steps in the group resolution. Returns a list of objects `{ kerberos, principal, permission, target }`.

### Group endpoints

Groups are defined in this service's database because we need to access them before we can speak to any other services. A group should have an entry in the ConfigDB under some appropriate class so that we have some idea what it represents.

Groups do not need explicitly creating; a group exists if and only if it has members.

#### `GET /authz/group`

Returns a list of UUIDs of all groups in the database.

#### `GET /authz/group/{group}`

Returns a list of UUIDs of the direct children of this group. Recursive groups are not expanded.

#### `PUT /authz/group/{group}/{member}`

Add a (direct) member from the group. Has an empty body.

#### `DELETE /authz/group/{group}/{member}`

Delete a (direct) member from the group.


### JSON dumps

The Auth service is able to load entries from a JSON dump. This allows entries to be bulk-loaded, and can also be used to bootstrap the service when it first starts up.

The dump format is a JSON object, matching this schema:

    title: Auth service JSON dump
    type: object
    required: [service, version]
    properties:
        service:
            description: Identifies the service this dump is for.
            const: "cab2642a-f7d9-42e5-8845-8f35affe1fd4"
        version:
            description: Dump format version number.
            const: 1
        principals:
            description: Kerberos mappings.
            type: array
            items:
                type: object
                properties:
                    uuid: { type: string, format: uuid }
                    kerberos: { type: string }
        groups:
            description: Groups to create.
            type: object
            propertyNames:
                description: Group UUID.
                type: string
                format: uuid
            additionalProperties:
                description: List of members to add.
                type: array
                items: { type: string, format: uuid }
        aces:
            description: ACL entries to add.
            type: array
            items:
                type: object
                properties:
                    principal: { type: string, format: uuid }
                    permission: { type: string, format: uuid }
                    target: { type: string, format: uuid }

The endpoint to load a dump is `POST /load`.

This accepts a dump file as body and loads it into the database. The client must have wildcard permission for `Manage_ACL`, `Manage_Group` and/or `Manage_Krb` as appropriate. Entries that fail (conflicting principal mappings) will be silently ignored.

## Permissions

The Auth service supports setting permissions on permissions, in order to control which clients can access or change which information. Defined permissions and their required targets are:

| Name             | UUID                                   | Target           |
|------------------|----------------------------------------|------------------|
| Auth permissions | `50b727d4-3faa-40dc-b347-01c99a226c58` | -                |
| Read_ACL         | `ba566181-0e8a-405b-b16e-3fb89130fbee` | Permission group |
| Read_Krb         | `e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c` | Principal        |
| Read_Eff         | `35252562-51e5-4dd8-84cd-ba0fafa62669` | Wildcard         |
| Manage_ACL       | `3a41f5ce-fc08-4669-9762-ec9e71061168` | Permission       |
| Manage_Group     | `be9b6d47-c845-49b2-b9d5-d87b83f11c3b` | Group            |
| Manage_Krb       | `327c4cc8-9c46-4e1e-bb6b-257ace37b0f6` | Principal        |

The 'Auth permissions' UUID is a permissions group, set up by the bootstrap dump, which contains the other permissions.

### Read_ACL

This grants permission to read ACLs (`/authz/acl`) for the target permission group. Services that use the Auth service as a source of ACLs will need this permission on any UUID they will pass as the `permission` parameter; normally this will be a group representing all permissions that service is interested in.

### Read_Krb

Grants permission to read Kerberos mappings. To search for a principal by Kerberos principal name this must be granted as a wildcard.

### Read_Eff

Grants permission to read effective permissions. This must always be granted as a wildcard.

### Manage_ACL

Grants permission to manage ACL entries affecting the target permission. If this is not granted as a wildcard then the only endpoint that can be used is `POST /authz/ace`.

*This is a result of the poor design of that endpoint. A more RESTful interface would allow better control.*

### Manage_Group

Permits the PUT and DELETE requests to edit group membership on the target group.

### Manage_Krb

Permits managing Kerberos mappings for the target principal.
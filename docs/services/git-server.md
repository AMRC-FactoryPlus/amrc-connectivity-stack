# Internal Git Server

ACS version 3 relies on [Flux](https://fluxcd.io) to control edge
clusters, and Flux relies on Git repositories. As such it has become
necessary for ACS to provide an internal Git server.

The server is entirely integrated into the Factory+ services.
Authentication is via Factory+ Kerberos principals, the same credentials
as used to authenticate to anything else. Configuration for the Git
service lives in the ConfigDB, and permissions are configured in the
Auth service.

The server has the ability to automatically mirror external repos into
an internal repo. This is useful when the central cluster can contact
the Internet but the edge clusters cannot. The server supports authentication
for private external repositories - see [Git Repository Authentication](git-auth.md)
for details.

## Git Repository Configuration ConfigDB Application

The 'Git repository configuration' Application has UUID
`38d62a93-b6b4-4f63-bad4-d433e3eaff29`. Entries of this type are created
by the `acs-service-setup`, by the Cluster Manager, or directly by an
administrator, and are used by the git service.

Each entry directly controls the existence of a git repo: creating the
entry makes the repo available, and removing it makes the repo
unavailable again. If an entry is deleted and then recreated the repo
will reappear with the same contents and history as before; repos can
only be permanently deleted from storage via the git service's REST API.

'Git repository configuration' entries should be objects with these
properties:

* `path`: The human-friendly path for the repo. Strictly speaking this
  is optional but usually it will be the only property of the config
  entry.
* `pull` (optional): Configure automatic pulling from external repos.
  This should be an object mapping branch names to pull instructions,
  which are objects with these properties:

    * `url`: The URL of the remote repo.
    * `ref`: The ref (branch or tag) to pull on the remote repo.
    * `interval`: A duration string saying how often to pull from the
      remote, or `never` to pull only once at server startup.
    * `merge` (optional): The name of another branch to merge pulls
      into.
    * `auth` (optional): Authentication configuration for private repositories.
      This should be an object with these properties:
      * `secretRef`: The name of a secret key containing credentials.
        See [Git Repository Authentication](git-auth.md) for details.

Branches named by `merge` are handled as follows: if the `merge` branch
sits at the same commit as the pulled branch before a pull operation, it
will be updated to the pulled commit after the pull. Otherwise it will
be left alone. This allows for automatic pulls unless and until the
local administrator decides to make their own commits, from which point
merges from the pulled branch will need to be made manually. A `merge`
branch can be hard-reset to the pulled branch to reactivate automatic
merging.

Branches which are auto-pulled should not be pushed to. The auto-pull
will ignore any local changes and simply update the branch to match the
remote commit. Changing the `url` or `ref` to pull from will trigger a
pull immediately, which will update to the newly requested commit
regardless of its relationship to the previous position of the branch.

## Git Server HTTP API

The Git server is normally deployed at `https://git.DOMAIN` where
`DOMAIN` is the ACS external base domain. In any case the base URL for
the server should normally be discovered via the Directory using the
Service UUID `7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b`.

Endpoints available under the base URL are:

### `/uuid/:uuid`

This is the Git repo URL for a repo with the given UUID. Pull and push
access are authenticated against the Auth service.

### `/git/:path`

This is the Git repo URL for a repo accessed via a human-friendly path.
If more than one repo is configured with the same path, none will be
accessible by path until the problem is fixed.

### `GET /v1/storage`

This returns a JSON array listing the UUIDs of all the repositories
which currently have storage allocated. Repos which have been created in
the ConfigDB but not allocated space on disk yet will not appear in the
list. Repos which have been deleted from the ConfigDB but which still
appear in this list will preserve their former contents and history if
they are recreated.

### `DELETE /v1/storage/:uuid`

Deletes the storage associated with a repo, permanently. If the repo
still exists in the ConfigDB, or if it is subsequently created, it will
revert to an empty repo.

## Git Repository Permissions

The Git server uses the following permissions in the Auth service.

### Pull from repo

    12ecb694-b4b9-4d2a-927e-d100019f7ebe

This grants permission to pull from a repo. It should be granted on the
repo UUID as target, or on an Auth group including the repo UUID.

### Push to repo

    b2d8d437-5060-4202-bcc2-bd2beda09651

This grants permission to push to a repo. It should be granted on the
repo UUID as target, or on an Auth group including the repo UUID.

### Manage repo storage

    7fd8a8c1-6050-4950-97bd-a35bb83ff750

This grants permission to list and delete repo storage. It should be
granted on the Null UUID; storage permissions for individual repos are
not supported.

## Git Server MQTT Interface

The Git server publishes as a Sparkplug Node, normally under the
`ORG-Service-Core/Git` address. The server publishes information about
the current state of all the repositories.

The metric structure of the Node birth certificate is as follows:

* `Schema_UUID`: `ee115c26-2ad6-4846-a771-da0cf6401399` Git Server v1.
* `Instance_UUID`: The UUID of the Git server Node.
* `Repositories`: A folder of metrics with a sub-folder named for the
  UUID of each configured repo. Each sub-folder contains:
    * `Schema_UUID`: `1bc8b1c1-e5e6-4777-814b-67bc58aaad62` Git Repo v1.
    * `Instance_UUID`: The UUID of the repo (the same as the folder
      name).
    * `Branches`: A folder of metrics with a metric for each branch in
      the repo. The metric value is the full SHA-1 of the branch.

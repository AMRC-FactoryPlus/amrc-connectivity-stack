# Internal Git server

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
the Internet but the edge clusters cannot.

## Git server HTTP API

The Git server is normally deployed at `https://git.DOMAIN` where
`DOMAIN` is the ACS external base domain. In any case the base URL for
the server should normally be discovered via the Directory using the
Service UUID `7adf4db0-2e7b-4a68-ab9d-376f4c5ce14b`.

## Git repository configuration ConfigDB Application

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

Branches named by `merge` are handled as follows: if the `merge` branch
sits at the same commit as the pulled branch before a pull operation, it
will be updated to the pulled commit after the pull. Otherwise it will
be left alone. This allows for automatic pulls unless and until the
local adminstrator decides to make their own commits, from which point
merges from the pulled branch will need to be made manually. A `merge`
branch can be hard-reset to the pulled branch to reactivate automatic
merging.

Branches which are auto-pulled should not be pushed to. The auto-pull
will ignore any local changes and simply update the branch to match the
remote commit. Changing the `url` or `ref` to pull from will trigger a
pull immediately, which will update to the newly requested commit
regardless of its relationship to the previous position of the branch.

## Git repository permissions



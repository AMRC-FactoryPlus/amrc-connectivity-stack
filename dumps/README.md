# Service dump files

This directory contains service dump files which must be loaded into the
Auth and ConfigDB service for the git server to function correctly.

The source for these dumps is the `*.yaml` files in this directory. The
`*.json` files are generated from these by running `npm run
convert-dumps`. Do not edit the JSON files by hand.

The Auth dump file expresses ACLs in terms of a Service Requirement UUID
which remains static across deployments. This must be implemented by a
particular deployment by creating an Auth group with the UUID of the
requirement and giving it the deployment-specific service account UUID
as a member.

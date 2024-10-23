# AMRC Connectivity Stack

The AMRC Connectivity Stack (ACS) is a comprehensive collection of open-source services developed by the AMRC that represents a complete end-to-end implementation of the [Factory+](https://factoryplus.app.amrc.co.uk) framework. It is distributed as a Kubernetes Helm chart an can be deployed onto any Kubernetes cluster.

## Quick Links
- [Release notes](ReleaseNotes.md)
- [Installation and getting started](docs/installation.md)
- [See what's new in ACS V3](docs/whats-changed-in-v3.md)
- [Factory+ framework reference](https://factoryplus.app.amrc.co.uk)
- [Contributor Guidelines](ContributorGuidelines.md)

## Edge Management in ACS
Most of the components deployed by ACS are implementations of the core components of Factory+, which intentionally leaves edge architecture and management paradigms undefined. In [ACS V3, we've introduced an advanced approach to managing edge configurations](docs/whats-changed-in-v3.md), incorporating several new components. For an overview of the edge management architecture and how it interacts with the Factory+ core components, see the links below:

* [Edge clusters: Overall architecture](./docs/edge-clusters.md)
* [Edge clusters: Deploying to the edge](./docs/edge-deployments.md)
* [Edge clusters: Bootstrap process](./docs/edge-bootstrap.md)
* [Internal Git server](./docs/git-server.md)

## Maintainers

| Name           | Email                       |
|----------------|-----------------------------|
| Alex Godbehere | <alex.godbehere@amrc.co.uk> |
| Ben Morrow     | <b.morrow@amrc.co.uk>       |

## Values

Refer to the [deploy/values.yaml](deploy/values.yaml) file for potential configurations. We avoid enumerating all options here due to their evolving nature; the `values.yaml` file serves as the definitive guide.

# i3X Spec - Upstream Proposals

Ideas and proposals we want to contribute to the i3X specification.
The spec is still in alpha (https://i3x.dev, https://github.com/cesmii/i3X)
so now is the time to get involved.

## Proposals

### SP1: Structural change notifications

**Problem**: The i3X spec provides SSE subscriptions for value changes, but
there is no mechanism to notify clients when the object hierarchy itself
changes (new devices appearing, devices being removed, relationships
changing). Clients must poll the explore endpoints to detect structural
changes.

**Use case**: A real-time visualiser showing the full object topology needs
to know when new devices come online or the hierarchy is restructured,
without polling every object on a timer.

**Proposed approach**: Extend the subscription mechanism to support
structural events - object created/deleted, relationship added/removed.
Could be a new event type on the existing SSE stream, or a separate
subscription channel.

**Status**: Idea stage. Needs discussion with CESMII / spec maintainers.

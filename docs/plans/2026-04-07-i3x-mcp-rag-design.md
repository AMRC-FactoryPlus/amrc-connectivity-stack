# i3X MCP RAG Server — Design Document

**Date:** 2026-04-07
**Status:** Approved

## Problem

AI agents interacting with an ACS deployment can use `acs-mcp` for raw Factory+
service access, but lack the ability to search, traverse, and analyse the i3X
object model by meaning and structure. The commercial `i3xrag` tool
(Data In Motion) provides this but ships as a Windows executable and requires a
crawl-and-index step against a remote i3X API.

## Solution

Embed an MCP server directly in the `acs-i3x` process, sharing the live
in-memory `ObjectTree`, `ValueCache`, and `History` instances. This eliminates
the crawl step entirely — the graph and search index are built from data that is
already loaded and kept current via MQTT subscriptions and ConfigDB polling.

## Architecture

### New Files

```
acs-i3x/
  src/
    rag/
      i3x-rag.ts            # Graph (graphology) + search (MiniSearch) engine
    mcp/
      tools.ts               # 12 MCP tool definitions
      transport.ts           # Streamable HTTP transport, mounted on Express
  test/
    rag/
      i3x-rag.test.ts        # Unit tests for graph + search engine
    mcp/
      tools.test.ts          # Integration tests for all MCP tools
      transport.test.ts      # HTTP transport tests via supertest
```

### New Dependencies

- `graphology` — in-memory graph data structure
- `graphology-shortest-path` — shortest path algorithms
- `graphology-traversal` — BFS/DFS traversal
- `graphology-types` — TypeScript type definitions
- `minisearch` — BM25-like text search
- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — parameter schema validation

### Initialisation Flow

```
existing:  fplus → ObjectTree → ValueCache → History → Subscriptions → WebAPI
new:                                ↓
                          I3xRag(objectTree, valueCache, history)
                                    ↓
                          McpServer(i3xRag)  — 12 tools registered
                                    ↓
                          Mount POST /mcp on Express app
```

No crawling step. The `I3xRag` class mirrors `ObjectTree` data into a
`graphology` undirected graph and a `MiniSearch` index at init time, then
re-syncs whenever `ObjectTree.refresh()` fires on the poll interval.

## I3xRag Class

### Graph (graphology)

On `init()`, iterates `ObjectTree.getObjects()` and builds an undirected graph:

- **Nodes:** one per `I3xObject`, keyed by `elementId`, with attributes
  `{ displayName, typeElementId, isComposition, parentId }`
- **Edges:** for each object with a `parentId`, add an undirected edge labeled
  `parent-child`. For composition objects, also add a `composition` edge.
  This means `find_path` and `neighborhood` traverse both hierarchy and
  composition relationships.

Methods:

- `traverse(elementId, hops)` — BFS from node, collect all visited nodes up to
  N hops, return with edge labels and depth
- `findPath(fromId, toId)` — unweighted shortest path via
  `graphology-shortest-path`
- `neighborhood(elementId, hops)` — all nodes within N hops, grouped by depth
- `compositionTree(elementId, maxDepth?)` — recursive descent through
  `ObjectTree.getChildElementIds()`, returns nested structure

### Search (MiniSearch)

On `init()`, indexes all objects with fields: `displayName`, `typeElementId`,
`parentDisplayName` (resolved from parentId). BM25 search over human-readable
names and type identifiers.

Methods:

- `search(query, limit?)` — full-text BM25 search, returns ranked results
- `searchByType(typeElementId, query, limit?)` — search filtered to one type
- `searchRelated(query, hops, limit?)` — search then auto-traverse each result
  N hops, return combined results

### Value Analysis

Delegates to `ValueCache` and `History` with filtering/aggregation logic.

Methods:

- `valueFilter(opts)` — iterate cached values, filter by quality/range/missing
- `staleValues(thresholdSeconds)` — find values older than threshold
- `getHistory(elementId, startTime, endTime)` — delegates to
  `History.queryHistory()`
- `relationshipMap()` — aggregate edges by typeElementId pairs, return type-level
  connection summary
- `typeSchema(typeElementId)` — child type distribution, relationship usage,
  value quality stats for all instances of this type

### Sync

`I3xRag.rebuild()` clears the graphology graph and MiniSearch index,
re-populates from current `ObjectTree` state. Called after
`ObjectTree.refresh()` completes.

## MCP Tools

12 tools across three categories. Registered via
`McpServer.tool(name, description, zodSchema, handler)`.

### Search Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `search` | `query: string`, `limit?: number` (default 20) | Ranked list: elementId, displayName, type, score |
| `search_by_type` | `type_element_id: string`, `query: string`, `limit?: number` | Same, filtered to one type |
| `search_related` | `query: string`, `hops?: number` (default 1), `limit?: number` | Search results + traversed neighbours |

### Graph Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `traverse` | `element_id: string`, `hops?: number` (default 1) | Nodes visited with depth and edge labels |
| `find_path` | `from_id: string`, `to_id: string` | Ordered path of nodes, or "no path found" |
| `neighborhood` | `element_id: string`, `hops?: number` (default 2) | All nodes within N hops, grouped by depth |
| `composition_tree` | `element_id: string`, `max_depth?: number` (default 0 = unlimited) | Nested JSON tree |

### Analysis Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `relationship_map` | _(none)_ | Type-level adjacency with edge counts |
| `type_schema` | `type_element_id: string` | Child patterns, relationships, quality stats |
| `value_filter` | `quality?: string`, `min_value?: number`, `max_value?: number`, `missing?: boolean` | Matching objects with values |
| `stale_values` | `threshold_seconds?: number` (default 300) | Objects with stale timestamps |
| `get_history` | `element_id: string`, `start_time: string`, `end_time: string` | Array of VQT records |

### Return Format

All tools return:
- Success: `{ content: [{ type: "text", text: JSON.stringify(result) }] }`
- Failure: `{ content: [{ type: "text", text: errorMessage }], isError: true }`

## MCP Transport

**Endpoint:** `POST /mcp` on the existing Express app.

Uses `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. Stateless
— each request gets a fresh transport connected to the shared `McpServer`
instance. All tools are read-only, so no session state is needed.

**Auth:** Inherits the same Kerberos / `DEV_NO_AUTH` middleware as the REST API.

## Testing Strategy

### `test/rag/i3x-rag.test.ts` — Unit Tests

Builds a realistic mock object tree:
- ISA-95 hierarchy (Enterprise → Site → Area → WorkCenter)
- Multiple devices with composition chains
- Leaf metrics with values in a mock ValueCache
- Mixed quality and stale values

Tests every method:
- **Search:** exact match, partial match, no results, search by type, search
  related with traversal
- **Graph:** traverse 1/2/N hops, find_path between connected/disconnected
  nodes, neighborhood at various depths, composition tree with/without depth
  limit
- **Analysis:** relationship_map correctness, type_schema aggregation,
  value_filter by each criterion, stale_values with threshold boundary,
  get_history delegation
- **Edge cases:** empty tree, single node, disconnected components, very deep
  composition chains, nodes with no values

### `test/mcp/tools.test.ts` — Integration Tests

Tests each of the 12 MCP tools:
- Valid parameters produce correct results
- Missing required parameters rejected by Zod
- Invalid parameter types rejected
- Error responses formatted correctly
- Result truncation for large result sets

### `test/mcp/transport.test.ts` — HTTP Transport Tests

Via supertest against Express app:
- `POST /mcp` with valid JSON-RPC `tools/list` returns tool catalogue
- `POST /mcp` with valid `tools/call` returns tool result
- Malformed JSON-RPC returns error
- Invalid tool name returns error
- Auth middleware applied (if not DEV_NO_AUTH)

## Decisions

- **ACS-locked:** this MCP server only works against an ACS-backed i3X instance.
  Not designed for arbitrary i3X servers.
- **Read-only:** no mutation tools. Matches the i3X server's read-only posture.
- **No crawl step:** graph and index built from live in-memory data.
- **Streamable HTTP transport:** the current MCP spec direction. No SSE fallback.
- **Approach A:** uses `graphology` + `minisearch` libraries rather than rolling
  our own graph algorithms.

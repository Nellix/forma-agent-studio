# Independently implemented workflow behavior

The design uses documented visual-automation concepts from n8n as a functional reference. No n8n implementation, package, source file, template, or asset is included. The public documentation consulted describes [workflow components](https://docs.n8n.io/build/understand-workflows.md) and [flow logic](https://docs.n8n.io/build/flow-logic.md). The code and JSON format here are independently written.

| Capability | This implementation |
| --- | --- |
| Visual graph | React Flow canvas, native Studio node configuration, independent graph schema |
| Triggers | Manual, authenticated webhook, timezone-aware cron |
| Data mapping | Typed JSON values, explicit `$ref` references, simple `$template` interpolation |
| Branches | Boolean Condition routes, skipped-node propagation |
| Merge | First active input, array of active inputs, or shallow object merge |
| Iteration | Explicit bounded For Each with a nested body graph |
| Reuse | Published immutable Studio agents |
| Execution history | Persistent run/node records and SSE events |
| Reliability | Leases, bounded retries, cancellation, restart recovery, uncertain-side-effect reporting |
| Credentials | Encrypted server-side references |
| Deferred | General subworkflow calls, human approvals, arbitrary code, cyclic graphs, connector marketplace, n8n JSON compatibility |

## Mapping

```json
{"emails":{"$ref":"input.emails"},"summary":{"$ref":"nodes.summarize.summary"}}
```

References use dot-separated property names (including array indices). Only `input`, upstream `nodes`, and the current iteration’s input are available. There is no `eval`, scripting, filesystem access, or arbitrary model-generated tool execution.

`{"$template":"Summary: {{nodes.summarize.summary}}"}` interpolates values without evaluating expressions. Map Fields and Output use a `value` configuration; Run Agent uses `agentId`, `version`, and `input`.

## Scheduling and branches

Each graph has exactly one trigger and one Output node. It must be acyclic and all nodes must be reachable from the trigger. A node waits until all parents are completed or skipped. It executes when at least one incoming edge is active. If every incoming edge is inactive it is skipped. Merge therefore does not hang on a condition branch that never runs. Graph-level failures stop subsequent work.

Independent ready nodes execute in batches of up to four. For Each processes an explicit array, with a configurable item limit (maximum 1,000), concurrency (maximum eight), and at most three nested For Each levels. A body receives `{item,index}`; its ordered outputs become the parent node’s array. Shared model slots cap endpoint requests across workers.

Published schedules activate separately. Publishing a new workflow version deactivates its previous trigger and clears its pending schedule; activate the new version after review. Each due schedule has a timestamp-based idempotency key. Missed intervals coalesce into one due execution after downtime; this MVP does not backfill every missed occurrence. The next time is calculated using cron-parser and the selected IANA timezone. Invalid schedule submissions deactivate the schedule and record a setting diagnostic.

## Retry and recovery

Transient failures can retry up to the node’s configured bound, with exponential backoff. Input/validation errors do not retry. HTTP side effects require an explicit downstream idempotency header before retries are accepted. The runtime supplies a stable key derived from workflow run and node IDs.

On worker recovery, completed/skipped nodes are reused. A safe interrupted node can run again. An interrupted non-idempotent HTTP request causes an `uncertain` run instead of an automatic repeat. External services determine the actual semantics of their idempotency headers: the application does not promise exactly-once remote effects. Cancellation stops scheduling and aborts compatible in-flight requests but cannot undo a remote operation already committed.

# Verification status

Validated locally on 28 October 2026, with Node.js 24.20.0 on Windows.

## Passed

- TypeScript checks for application and test sources.
- Production frontend and backend builds.
- 25 integration tests using PGlite, including real HTTP requests to local mock inference servers. Coverage includes schema validation, source references, immutable versions, stale writes and publishes, idempotency, both workflow branches, bounded iteration, model inheritance, snapshots, builder edits, cancellation, leases, crash recovery, uncertain side effects, encrypted credentials, sessions, access tokens, origin checks, structured-output repair, streaming, HTTP allowlists and retries, and schedule deduplication.
- Browser checks: create and rename an agent; refine it through chat; run, publish, and reload it with persistent output; execute and publish Inbox Digest; inspect completed and skipped steps; inspect model setup; apply Apps preview themes and verify app publishing is disabled.
- Responsive homepage at 390 x 844, without document-level horizontal overflow.
- YAML structure checks for Kubernetes workloads, probes, storage, secret references, resource limits, and Compose.
- Production dependency inventory: 119 dependencies, none missing license metadata. Available license and notice files are included.

The browser pass found and fixed a React effect cleanup problem after chat edits. The complete agent journey was repeated after that fix. Execution polling also tolerates temporary network failures and stops fetching terminal runs.

## Not yet exercised

- The actual on-prem GLM endpoint, its TLS chain, authentication, context limit, and response-format capabilities. The supplied demo model is deterministic and labeled accordingly.
- Docker image execution, a live PostgreSQL server, and a Kubernetes cluster. Docker and Kubernetes tools are unavailable on this machine. Manifests were structurally checked, not deployed or server-side validated.
- The Playwright command-line suite. Three regression tests are provided for CI; local interactive browser checks exercised their main journeys.
- GitHub Actions. Validation and optional image-publishing workflows are provided; the results above describe local validation, not a remote CI run.

This release is a single-workspace testing MVP. See the README and deployment guide for scope and operational assumptions.

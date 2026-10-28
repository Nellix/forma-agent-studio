# Forma · Agent Studio

An on-prem studio for conversational agent development and native workflow automation. The browser UI, API, and worker are original implementations. n8n is not installed, embedded, called, or included.

## What works

- Conversational agent and workflow editing through a configurable OpenAI-compatible endpoint, with schema validation, persistent chat, autosaved drafts, undo, and immutable published versions.
- Email Summary playground with editable sample emails, source-linked results, model selection, and execution history.
- Native visual workflow editor: manual/webhook/schedule triggers, agent execution, HTTP requests, mappings, conditions, merges, bounded For Each, and outputs.
- PostgreSQL-backed execution jobs, worker leases, persistent node results, bounded retries, cancellation, event streaming, and crash recovery.
- Model registry, encrypted credentials, administrator sessions, and a separate execution token.
- Apps is deliberately an **interactive mockup**, labeled Preview only. Its suggested chat changes are deterministic.

Demo inference is also explicitly labeled. It exercises the real persistence and workflow engine while using deterministic email results and limited builder edits. Connect a model for unrestricted conversational editing and real summaries. The demo adapter is specialized for the supplied email template; arbitrary output schemas need a real model.

## Test on Kubernetes

Read [the deployment guide](docs/deployment.md). The shortest path after building and pushing the image is:

```sh
node scripts/secrets.mjs --k8s
# Edit deploy/k8s/kustomization.yaml: set images[0].newName to your registry image.
kubectl apply -k deploy/k8s
kubectl -n agent-studio rollout status statefulset/studio-postgres --timeout=180s
kubectl -n agent-studio rollout status deployment/studio-api --timeout=300s
kubectl -n agent-studio rollout status deployment/studio-worker --timeout=300s
kubectl -n agent-studio port-forward service/studio 3000:80
```

Open http://localhost:3000 and sign in with `STUDIO_ADMIN_TOKEN` from the generated, untracked `deploy/k8s/secret.env`. The base manifests target an internal test deployment and do not expose a public ingress.

## Run locally

Node.js 24+ is required.

For a local demo without a model endpoint, build once and run `npm run demo`. It binds to `127.0.0.1:3000`, stores projects in `.data/local`, and creates a local encryption key for model credentials. With no existing administrator token, the loopback demo opens without sign-in. On Windows, `scripts/start-local.ps1` starts it in the background and `scripts/stop-local.ps1` stops that process. These scripts also locate the Node runtime bundled with Codex when Node is not on PATH.

```sh
npm ci
npm run secrets
npm run build
npm start
```

Open http://localhost:3000. The generated `.env` configures persistent PGlite (embedded PostgreSQL) and an embedded worker for local development. Production and separate workers require PostgreSQL.

For frontend development, run `npm run dev` and `npm run dev:web` in separate terminals; use the Vite URL, http://127.0.0.1:5173. The API and frontend are proxied under the same origin.

Docker Compose starts PostgreSQL, the API, and a separate worker:

```sh
npm run secrets  # once; skip if .env already exists
docker compose up --build -d
```

## Connect GLM 5.3

1. Open Settings → Add model.
2. Supply your API base URL (for example `http://glm-service.llm.svc.cluster.local:8000/v1`) and the actual served model ID.
3. Add an API key if required. Credentials are encrypted on the server; the browser receives only the reference name.
4. Select supported streaming and structured-output options, save, and test the connection.
5. Set it as the workspace default or choose it for a builder, agent, test run, workflow, or individual agent step.

The label “GLM 5.3” does not assume a particular model ID or server implementation. Chat Completions is the baseline; model discovery is optional. No cloud fallback is implemented. Internal certificate authorities can be mounted and supplied through `NODE_EXTRA_CA_CERTS` in both API and worker containers.

## First complete journey

Open **Email Summary**, ask the builder to group by sender, run a sample, and publish. Open **Inbox Digest**, select the published version in its Run Agent step, run the workflow, inspect the priority/regular branches, and publish it. Activate its trigger separately before calling the webhook.

Publishing a new workflow version deactivates its old trigger. Review the new version and activate it explicitly.

## Development and verification

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run licenses
node scripts/validate-manifests.mjs
```

The integration suite runs against embedded PostgreSQL by default. Set `TEST_DATABASE_URL` to a disposable PostgreSQL database whose name ends in `_test` to run the same suite against the server; that test database is cleared by the suite. CI exercises both database configurations, browser journeys, and the Docker build.

See [architecture](docs/architecture.md), [workflow behavior](docs/workflow-design.md), [API reference](docs/api.md), and [verification status](docs/verification.md).

## Scope

This is a single-workspace testing MVP. It uses one administrator access token plus a separate runner token, not enterprise SSO or multi-user RBAC. There is no mailbox connector, connector marketplace, arbitrary code node, unrestricted cyclic graph, human approval system, or app deployment engine. Ultimate is not required on the Kubernetes cluster; the product runs as a standalone application and can be developed from Ultimate like any repository.

Original code is reserved for the project owner’s licensing decision. Third-party licenses and notices are preserved separately; this is not a relicensed n8n distribution.

# API quick reference

The full OpenAPI 3.1 document is [openapi.json](openapi.json), also served at `/api/openapi.json` after authentication.

Use `Authorization: Bearer <token>`. The administrator token manages models, secrets, drafts, and publishing. The runner token can execute published versions, call active webhooks, and inspect/cancel workspace runs. It cannot edit definitions or models.

## Run a published agent

```sh
curl -X POST http://localhost:3000/api/agents/email-summary/versions/1/runs \
  -H "Authorization: Bearer $STUDIO_RUNNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: email-summary-test-001' \
  --data '{"input":{"emails":[],"language":"English"},"modelId":"your-configured-model-id"}'
```

The response is HTTP 202 and a Run object with `id`. Omit `modelId` to inherit the published agent/workspace default.

```sh
curl http://localhost:3000/api/runs/RUN_ID -H "Authorization: Bearer $STUDIO_RUNNER_TOKEN"
curl -N http://localhost:3000/api/runs/RUN_ID/events -H "Authorization: Bearer $STUDIO_RUNNER_TOKEN"
curl -X POST http://localhost:3000/api/runs/RUN_ID/cancel -H "Authorization: Bearer $STUDIO_RUNNER_TOKEN" -H 'Content-Type: application/json' --data '{}'
```

The event stream contains monotonic IDs. Reconnect with `Last-Event-ID`. Terminal state is one of completed, failed, cancelled, or uncertain. The `output` field contains validated agent/workflow output; errors are separate. Node results are included when fetching an individual run.

## Run a workflow

Use `POST /api/workflows/{id}/versions/{version}/runs` with `{input,modelId?}`. A request model overrides the workflow default, while an explicit agent-step model still has priority.

After publishing and activating a webhook workflow, `POST /api/hooks/{id}` accepts the workflow input directly and returns `{runId,statusUrl}`. It requires the same bearer authentication. A webhook does not wait for long-running inference.

## Drafts and publishing

`PUT /api/agents/{id}` and `PUT /api/workflows/{id}` accept `{revision,spec}`. Stale revisions return HTTP 409. Workflow drafts may temporarily contain disconnected nodes; publish/run validates graph semantics.

`POST .../{id}/publish` accepts `{revision}` and returns `{version}`. Published agent versions never change. Workflow nodes pin agent versions. Publishing a workflow does not by itself activate its external trigger; use `POST /api/workflows/{id}/active` with `{active:true}`.

## Builder jobs

`POST .../{id}/build` accepts `{message,revision,modelId?}` and returns an asynchronous run. Its result contains the validated new spec and a change summary. If the draft changes before the builder finishes, the job fails with a revision conflict instead of overwriting user edits.

## Models and credentials

Save endpoint metadata using `PUT /api/models/{id}`. The base URL is joined with `/chat/completions`; discovery uses `/models`. Set the served model ID explicitly if discovery is unavailable. Connection testing verifies the chosen streaming and structured-output configuration, not tool calling.

`PUT /api/secrets/{REFERENCE_NAME}` accepts `{value}` and never returns the value. Model/HTTP configurations contain only the reference. Do not put keys in URLs, prompts, or workflow JSON.

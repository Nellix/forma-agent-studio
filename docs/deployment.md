# Deploy to Kubernetes for testing

## 1. Build an image your cluster can pull

From the repository root, replace the image name with your registry/repository:

```sh
docker build -t REGISTRY/OWNER/agent-studio:0.1.0 .
docker push REGISTRY/OWNER/agent-studio:0.1.0
```

Alternatively, after pushing the repository to GitHub, run the **Publish test image** workflow from the Actions page. It publishes `ghcr.io/<owner>/<repository>:0.1.0` using the repository’s Actions token. Packages may be private; configure an image pull secret in your cluster as required. The included **Validate** workflow builds without publishing on pushes and pull requests.

For a local kind cluster, build `agent-studio:0.1.0` and load it with `kind load docker-image agent-studio:0.1.0`. Use the unmodified image name in that case.

## 2. Prepare configuration

```sh
node scripts/secrets.mjs --k8s
```

This writes `deploy/k8s/secret.env`, excluded from Git and Docker contexts. It contains the database password/URL, administrator token, runner token, and encryption key. Keep a secure backup. Changing the encryption key without re-encrypting existing secrets makes those secrets unreadable. The generator refuses to overwrite an existing file.

Edit `deploy/k8s/kustomization.yaml`:

- Set `images[0].newName` to the registry image and `newTag` to your tag.
- Keep `DEMO_MODE=true` for the initial sample journey. Real models still work while demo mode is enabled. Disable the demo provider in Settings to avoid selecting it. Set `DEMO_MODE=false` and select a real default model when ready; a previously selected demo default must be changed explicitly.
- Set `HTTP_ALLOWED_HOSTS` to exact `host` or `host:port` entries permitted for HTTP Request nodes. This is separate from administrator-configured model endpoints.
- Confirm your cluster has a default StorageClass. Otherwise add `storageClassName` to the PostgreSQL volume claim template.
- For private registries, add `imagePullSecrets` to both application Deployment pod specs using a secret in the `agent-studio` namespace.

The PostgreSQL manifest is a single-replica test database with a 5 GiB persistent volume. Use your managed or operator-managed PostgreSQL for shared/production use: remove the bundled database resources and put the external connection URL in `secret.env`.

## 3. Apply and open

```sh
kubectl apply -k deploy/k8s
kubectl -n agent-studio rollout status statefulset/studio-postgres --timeout=180s
kubectl -n agent-studio rollout status deployment/studio-api --timeout=300s
kubectl -n agent-studio rollout status deployment/studio-worker --timeout=300s
kubectl -n agent-studio get pods,pvc,services
kubectl -n agent-studio port-forward service/studio 3000:80
```

Browse to http://localhost:3000. Enter the generated administrator token. A short startup failure while the database initializes is recoverable: probes and restart policy allow the application to reconnect.

The API and worker use the same image with different commands. Both run without root, with a read-only root filesystem, dropped capabilities, and no Kubernetes API token. Database migrations run under a PostgreSQL transaction/advisory lock at startup. The default single worker can execute four runs concurrently; scale workers for throughput after validating your inference service’s capacity.

## 4. Configure your model

Use a URL reachable **from both API and worker pods**. `localhost` inside a pod is not your inference server. Select the served model ID manually if `/models` is unavailable. Test the configured streaming/JSON mode in Settings before selecting it for an agent.

For an internal CA, mount a ConfigMap or Secret containing the CA bundle into both workloads and add `NODE_EXTRA_CA_CERTS=/certificates/internal-ca.pem`. The process reads this setting on startup. Do not disable certificate verification.

## 5. Verify the whole path

1. Open Email Summary and run the sample input with Demo or a real model.
2. Make a conversational change and publish a new version.
3. Open Inbox Digest, select that version in the agent step, and run it.
4. Inspect the execution drawer: one condition branch is skipped and Merge completes.
5. Publish the workflow and activate the webhook in Workflow settings.
6. Call the webhook with `Authorization: Bearer <runner-token>` and the email JSON body. It returns a run ID and status URL.
7. Restart the worker during an appropriate test run; inspect recovery and node history. An interrupted non-idempotent HTTP side effect is reported as uncertain rather than silently retried.

## Optional ingress

The base deployment uses a ClusterIP service and port forwarding. `ingress.example.yaml` is deliberately excluded from Kustomize. Replace its host, class, and TLS secret if you need an ingress, then configure:

```text
PUBLIC_ORIGIN=https://your-studio-host
COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
```

Choose the proxy hop count for your actual trusted topology; do not expose the application directly while trusting arbitrary forwarded headers. Preserve SSE streaming by disabling proxy buffering. Restrict network access to the intended internal users.

## Operations and limitations

- View logs with `kubectl -n agent-studio logs deployment/studio-api` and `kubectl -n agent-studio logs deployment/studio-worker`.
- `ImagePullBackOff`: verify image/tag, registry credentials, and pull access.
- `Pending` PostgreSQL pod/PVC: configure a StorageClass or storage capacity.
- Model error: check pod-to-endpoint connectivity, CA trust, base URL, model ID, credentials, and capability switches.
- Queued runs: check worker health and its database connection.
- Preserve the PVC, encryption key, and database backup together. Deleting a namespace is not part of the upgrade procedure.
- Apply updated manifests and immutable image tags to upgrade. Published agent/workflow versions are independent of container versions.
- Inputs, results, and builder conversations are retained in PostgreSQL. Automated retention, backup orchestration, SSO, and multi-user authorization are not included in this test release.
- No Kubernetes cluster, Docker daemon, registry, or actual GLM endpoint was available in the authoring environment. Follow CI and this deployment checklist to validate those environments.

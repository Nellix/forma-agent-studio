import {readFile} from 'node:fs/promises';
import {parseAllDocuments,parse} from 'yaml';
import assert from 'node:assert/strict';
const root='deploy/k8s/';
const k=parse(await readFile(root+'kustomization.yaml','utf8'));
assert(k.kind==='Kustomization');assert(k.secretGenerator[0].envs.includes('secret.env'));
const docs=[];for(const file of k.resources){for(const doc of parseAllDocuments(await readFile(root+file,'utf8'))){assert.equal(doc.errors.length,0,`${file} must parse`);docs.push(doc.toJSON());}}
const deployments=docs.filter(d=>d.kind==='Deployment');assert.equal(deployments.length,2);
for(const d of deployments){const p=d.spec.template.spec;assert.equal(p.automountServiceAccountToken,false);assert.equal(p.securityContext.runAsNonRoot,true);assert(p.containers[0].readinessProbe);assert(p.containers[0].livenessProbe);assert(p.containers[0].startupProbe);assert(p.containers[0].resources.limits.memory);assert(p.containers[0].envFrom.some(e=>e.secretRef?.name==='studio-secrets'));}
assert(docs.some(d=>d.kind==='StatefulSet'&&d.spec.volumeClaimTemplates[0].spec.resources.requests.storage));
assert(docs.some(d=>d.kind==='Service'&&d.metadata.name==='studio'&&d.spec.ports[0].targetPort==='http'));
const compose=parse(await readFile('compose.yaml','utf8'));assert(compose.services.worker.command.includes('--worker'));assert.equal(compose.services.api.read_only,true);
console.log('Kubernetes YAML, probes, persistence, credentials, workload settings, and Compose structure validated. A live cluster has not been contacted.');

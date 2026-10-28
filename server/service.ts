import {createHash,randomUUID} from 'node:crypto';
import {DB,HttpError} from './db.js';
import {resolveModel} from './models.js';
import {validateAgent,validateWorkflow,validateData} from './validation.js';
import {emailAgent,inboxWorkflow} from '../shared/templates.js';
import type {EntityKind,RunKind,WorkflowSpec,ModelConfig} from '../shared/types.js';
export async function seed(db:DB){
 const [{count}]=await db.query('SELECT count(*)::integer AS count FROM entities');if(count)return;
 await db.transaction(async q=>{await q('INSERT INTO entities(id,kind,draft,published_version) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING',['email-summary','agent',JSON.stringify(emailAgent)]);await q('INSERT INTO versions(entity_id,version,spec) VALUES($1,1,$2) ON CONFLICT DO NOTHING',['email-summary',JSON.stringify(emailAgent)]);await q('INSERT INTO entities(id,kind,draft) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',['inbox-digest','workflow',JSON.stringify(inboxWorkflow)]);});
 if(process.env.DEMO_MODE==='true'){const m:ModelConfig={id:'studio-demo',name:'Studio Demo',baseUrl:'',model:'deterministic-demo',secretRef:null,enabled:true,streaming:false,structuredOutput:'schema',toolCalling:false,timeoutMs:120000,maxConcurrent:4,contextTokens:32768,demo:true};await db.query('INSERT INTO models(id,config) VALUES($1,$2) ON CONFLICT DO NOTHING',[m.id,JSON.stringify(m)]);await db.setSetting('defaultModel',m.id);}
}
export async function prepare(db:DB,kind:EntityKind,spec:any,override?:string){
 if(kind==='agent'){validateAgent(spec);return {model:await resolveModel(db,override,spec.modelId)};}
 const workflow=validateWorkflow(spec);const resolved:any={agents:{},models:{}};
 const visit=async(w:WorkflowSpec,prefix='')=>{for(const n of w.nodes){if(n.type==='agent'){const agent=await db.version(String(n.config.agentId),Number(n.config.version));const e=await db.entity(String(n.config.agentId));if(e.kind!=='agent')throw new HttpError(422,'Run Agent requires an agent');validateAgent(agent);resolved.agents[prefix+n.id]=agent;resolved.models[prefix+n.id]=await resolveModel(db,String(n.config.modelId??'')||null,override,workflow.modelId,agent.modelId);}if(n.type==='foreach')await visit(n.config.body as WorkflowSpec,`${prefix}${n.id}/*/`);}};await visit(workflow);return resolved;
}
export async function startRun(db:DB,kind:EntityKind,id:string,version:number|null,input:any,override?:string,key?:string){
 const e=await db.entity(id);if(e.kind!==kind)throw new HttpError(404,'Project type does not match');const spec=version===null?e.draft:await db.version(id,version);validateData(spec.inputSchema,input);
 const hash=createHash('sha256').update(JSON.stringify({kind,id,version,input,override,draftRevision:version===null?e.revision:null})).digest('hex');const scopedKey=key?`${kind}:${id}:${version??'draft'}:${key}`:undefined;
 if(scopedKey){const [old]=await db.query('SELECT id,request_hash FROM runs WHERE idempotency_key=$1',[scopedKey]);if(old){if(old.request_hash!==hash)throw new HttpError(409,'Idempotency key was reused with different input');return db.run(old.id);}}
 const resolved=await prepare(db,kind,spec,override);return db.enqueue(kind,id,version,input,spec,resolved,scopedKey,hash);
}
export async function startBuild(db:DB,kind:EntityKind,id:string,message:string,revision:number,modelId?:string){const e=await db.entity(id);if(e.kind!==kind)throw new HttpError(404,'Project type does not match');if(e.revision!==revision)throw new HttpError(409,'Draft changed. Reload before asking the builder.');const model=await resolveModel(db,modelId);const messages=await db.query('SELECT role,text FROM conversations WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 12',[id]);await db.query('INSERT INTO conversations(id,entity_id,role,text) VALUES($1,$2,$3,$4)',[randomUUID(),id,'user',message]);return db.enqueue(`builder-${kind}` as RunKind,id,null,{message,revision,history:messages.reverse()},e.draft,{model});}

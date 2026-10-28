import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {CronExpressionParser} from 'cron-parser';
import {z} from 'zod';
import {AgentSchema,WorkflowSchema,type Run,type WorkflowSpec,type WorkflowNode,type ModelConfig,type AgentSpec} from '../shared/types.js';
import {DB,HttpError,type Query} from './db.js';
import {checkUrl,executeAgent,readJsonLimited,secret,structuredCompletion} from './models.js';
import {condition,mapValue,safeToRetry,validateAgent,validateData,validateWorkflow} from './validation.js';
import {startRun} from './service.js';
type Emit=(type:string,data:any)=>Promise<void>;
export class UncertainError extends Error{}
export class Engine {
 private active=new Map<string,AbortController>();private stopped=false;private polling=false;
 constructor(public db:DB,public concurrency=4){}
 async tick(){if(this.stopped||this.polling)return;this.polling=true;try{await this.schedules();while(this.active.size<this.concurrency){const owner=randomUUID();const run=await this.db.claim(owner);if(!run)break;const controller=new AbortController();this.active.set(run.id,controller);void this.execute(run,owner,controller).finally(()=>this.active.delete(run.id));}}finally{this.polling=false;}}
 async stop(){this.stopped=true;for(const c of this.active.values())c.abort(new Error('Worker shutting down'));while(this.active.size)await sleep(50);}
 async schedules(){const due=await this.db.query(`SELECT s.entity_id,s.next_at,e.published_version,v.spec FROM schedules s JOIN entities e ON e.id=s.entity_id JOIN versions v ON v.entity_id=e.id AND v.version=e.published_version WHERE e.active=true AND s.next_at<=now() LIMIT 25`);for(const row of due){const n=(row.spec as WorkflowSpec).nodes.find(n=>n.type==='schedule');if(!n)continue;const cursor=new Date(row.next_at);const next=CronExpressionParser.parse(String(n.config.cron),{tz:String(n.config.timezone),currentDate:new Date(Math.max(cursor.getTime(),Date.now()))}).next().toDate();try{await startRun(this.db,'workflow',row.entity_id,row.published_version,n.config.input??{},undefined,`schedule-${cursor.toISOString()}`);await this.db.query('UPDATE schedules SET next_at=$2 WHERE entity_id=$1 AND next_at=$3',[row.entity_id,next,cursor]);}catch(e){await this.db.query('UPDATE entities SET active=false WHERE id=$1',[row.entity_id]);await this.db.setSetting(`scheduleError:${row.entity_id}`,e instanceof Error?e.message:'Schedule failed');}}}
 async execute(run:Run,owner:string,controller:AbortController){
  const db=this.db;const emit:Emit=async(type,data)=>{await db.owned(run.id,owner,q=>db.event(run.id,type,data,q));};
  let checking=false;const heartbeat=setInterval(async()=>{if(checking)return;checking=true;try{const [r]=await db.query(`UPDATE runs SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND lease_owner=$2 AND state='running' AND lease_until>now() RETURNING cancel_requested`,[run.id,owner]);if(!r)controller.abort(new Error('Execution lease lost'));else if(r.cancel_requested)controller.abort(new Error('Cancelled'));}catch{controller.abort(new Error('Execution storage unavailable'));}finally{checking=false;}},1000);
  try{
   if(run.cancelRequested)throw new Error('Cancelled');await emit('started',{kind:run.kind});let output;
   if(run.kind==='agent')output=await executeAgent(db,run.snapshot,run.input,run.resolved.model,controller.signal,emit);
   else if(run.kind==='workflow')output=await this.graph(run,owner,run.snapshot,run.input,controller.signal,emit);
   else output=await this.build(run,owner,controller.signal,emit);
   controller.signal.throwIfAborted();await db.owned(run.id,owner,async q=>{const [state]=await q('SELECT cancel_requested FROM runs WHERE id=$1',[run.id]);if(state.cancel_requested)throw new Error('Cancelled');await q(`UPDATE runs SET state='completed',output=$2,finished_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1`,[run.id,JSON.stringify(output)]);await db.event(run.id,'completed',{output},q);});
  }catch(e){const message=e instanceof Error?e.message:'Execution failed';try{await db.owned(run.id,owner,async q=>{if(this.stopped){await q('UPDATE runs SET lease_until=now() WHERE id=$1',[run.id]);return;}const [current]=await q('SELECT cancel_requested FROM runs WHERE id=$1',[run.id]);const state=current.cancel_requested?'cancelled':e instanceof UncertainError?'uncertain':'failed';await q('UPDATE runs SET state=$2,error=$3,finished_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1',[run.id,state,message]);await db.event(run.id,state,{message},q);});}catch{/* Another worker owns recovery. Never overwrite it. */}}
  finally{clearInterval(heartbeat);}
 }
 private async nodeState(run:Run,owner:string,id:string,state:string,attempt:number,output:any=null,error:string|null=null){await this.db.owned(run.id,owner,async q=>{await q(`INSERT INTO node_runs(run_id,node_id,state,attempt,output,error,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $3='running' THEN now() ELSE NULL END,CASE WHEN $3 IN ('completed','failed','skipped') THEN now() ELSE NULL END) ON CONFLICT(run_id,node_id) DO UPDATE SET state=excluded.state,attempt=excluded.attempt,output=excluded.output,error=excluded.error,started_at=COALESCE(node_runs.started_at,excluded.started_at),finished_at=excluded.finished_at`,[run.id,id,state,attempt,JSON.stringify(output),error]);await this.db.event(run.id,'node',{nodeId:id,state,attempt,error},q);});}
 async graph(run:Run,owner:string,spec:WorkflowSpec,input:any,signal:AbortSignal,emit:Emit,prefix=''):Promise<any>{
  validateData(spec.inputSchema,input);const existing=await this.db.query('SELECT * FROM node_runs WHERE run_id=$1',[run.id]);const state=new Map<string,any>();for(const n of spec.nodes){const row=existing.find(r=>r.node_id===prefix+n.id);if(row)state.set(n.id,row);}
  const outputs:Record<string,any>={};for(const [id,row] of state)if(row.state==='completed')outputs[id]=row.output;
  const terminal=(id:string)=>['completed','skipped'].includes(state.get(id)?.state);
  const activeEdge=(e:WorkflowSpec['edges'][number])=>state.get(e.source)?.state==='completed'&&(e.sourcePort==='default'||outputs[e.source]?.branch===(e.sourcePort==='true'));
  while(spec.nodes.some(n=>!terminal(n.id))){signal.throwIfAborted();const ready=spec.nodes.filter(n=>!terminal(n.id)&&spec.edges.filter(e=>e.target===n.id).every(e=>terminal(e.source)));if(!ready.length)throw new Error('Workflow has no executable node');
   const batchAbort=new AbortController();const batchSignal=AbortSignal.any([signal,batchAbort.signal]);const results=await Promise.allSettled(ready.slice(0,4).map(async n=>{try{
    const row=state.get(n.id);const nodeId=prefix+n.id;const incoming=spec.edges.filter(e=>e.target===n.id);
    if(incoming.length&&!incoming.some(activeEdge)){await this.nodeState(run,owner,nodeId,'skipped',0);state.set(n.id,{state:'skipped'});return;}
    if(row?.state==='failed')throw new Error(row.error??`${n.name} failed before the worker restarted.`);
    if(row?.state==='running'&&!safeToRetry(n))throw new UncertainError(`${n.name}: worker stopped during an external side effect. Verify the remote outcome before retrying.`);
    const context={input,nodes:outputs,item:input?.item};const startAttempt=row?.state==='running'?row.attempt:row?.state==='retrying'?row.attempt+1:1;
    for(let attempt=startAttempt;attempt<=n.retries+1;attempt++){
     batchSignal.throwIfAborted();await this.nodeState(run,owner,nodeId,'running',attempt);try{
      const effective=AbortSignal.any([batchSignal,AbortSignal.timeout(n.timeoutMs)]);
      const value=await this.executeNode(run,owner,n,context,incoming.filter(activeEdge).map(e=>outputs[e.source]),effective,emit,nodeId);
      effective.throwIfAborted();await this.nodeState(run,owner,nodeId,'completed',attempt,value);outputs[n.id]=value;state.set(n.id,{state:'completed',output:value});break;
     }catch(e){if(batchSignal.aborted)throw e;const error=e instanceof Error?e.message:'Node failed';if(n.type==='http'&&!safeToRetry(n)&&!(e instanceof HttpError))throw new UncertainError(`${n.name}: the external request outcome is unknown (${error}).`);if(attempt>n.retries||e instanceof UncertainError||(e instanceof HttpError&&e.status<500)){await this.nodeState(run,owner,nodeId,'failed',attempt,null,error);throw e;}await this.nodeState(run,owner,nodeId,'retrying',attempt,null,error);await sleep(Math.min(10000,500*2**(attempt-1)),undefined,{signal:batchSignal});}
    }
   }catch(e){batchAbort.abort(e);throw e;}}));const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
  }
  const result=outputs[spec.nodes.find(n=>n.type==='output')!.id];if(result===undefined)throw new Error('No output branch was reached');validateData(spec.outputSchema,result,'Workflow output');return result;
 }
 private async executeNode(run:Run,owner:string,n:WorkflowNode,context:any,parents:any[],signal:AbortSignal,emit:Emit,nodeId:string):Promise<any>{
  const c=n.config as any;
  switch(n.type){
   case 'manual':case 'webhook':case 'schedule':return context.input;
   case 'map':case 'output':return mapValue(c.value??{$ref:'input'},context);
   case 'condition':{const left=mapValue(c.left,context);return {branch:condition(left,c.operator,mapValue(c.right,context)),value:left};}
   case 'merge':return c.mode==='array'?parents:c.mode==='object'?Object.assign({},...parents):parents[0];
   case 'agent':{const key=nodeId.replace(/\/i\d+\//g,'/*/');const spec=run.resolved.agents[key];const model=run.resolved.models[key];if(!spec||!model)throw new Error('Agent snapshot is missing');const value=await executeAgent(this.db,spec,mapValue(c.input??{$ref:'input'},context),model,signal,(type,data)=>emit(type,{...data,nodeId}));return value;}
   case 'http':{
    const url=checkUrl(c.url);const allowed=(process.env.HTTP_ALLOWED_HOSTS??'').split(',').map(x=>x.trim()).filter(Boolean);if(!allowed.includes(url.host))throw new HttpError(422,`HTTP host ${url.host} is not in HTTP_ALLOWED_HOSTS`);
    const method=c.method??'GET';const headers:Record<string,string>={'Content-Type':'application/json'};if(c.secretRef){const key=await secret(this.db,c.secretRef);if(!key)throw new HttpError(422,'HTTP credential is missing');headers.Authorization=`Bearer ${key}`;}if(c.idempotencyHeader)headers[String(c.idempotencyHeader)]=`${run.id}:${nodeId}`;
    const response=await fetch(url,{method,headers,redirect:'error',signal,...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(mapValue(c.body??{},context))}:{})});if(!response.ok){await response.body?.cancel();throw new HttpError(response.status>=500?502:422,`HTTP Request returned ${response.status}`);}if(response.status===204||method==='HEAD')return {status:response.status};return readJsonLimited(response);
   }
   case 'foreach':{
    const items=mapValue(c.items,context);if(!Array.isArray(items))throw new HttpError(422,'For Each input must be an array');if(items.length>c.maxItems)throw new HttpError(422,'For Each exceeded its item limit');const output=new Array(items.length);let index=0;const innerAbort=new AbortController();const combined=AbortSignal.any([signal,innerAbort.signal]);const results=await Promise.allSettled(Array.from({length:Math.min(c.concurrency,items.length)},async()=>{while(index<items.length){combined.throwIfAborted();const i=index++;try{output[i]=await this.graph(run,owner,c.body,{item:items[i],index:i},combined,emit,`${nodeId}/i${i}/`);}catch(e){innerAbort.abort(e);throw e;}}}));const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;return output;
   }
  }
 }
 private async build(run:Run,owner:string,signal:AbortSignal,emit:Emit){
  const isAgent=run.kind==='builder-agent';const model:ModelConfig=run.resolved.model;await emit('activity',{message:'Reading your request'});let spec=structuredClone(run.snapshot);let summary='Updated your draft. Review it in the preview and run a test.';
  if(model.demo){await sleep(200,undefined,{signal});const text=String(run.input.message).toLowerCase();if(isAgent){spec.instructions+='\nUser refinement: '+run.input.message;if(/sender|group/.test(text)){spec.preview.groupBySender=true;spec.instructions+='\nGroup the emails by sender in the groups output.';}if(/short|concise|brief/.test(text)){spec.preview.concise=true;spec.instructions+='\nKeep the summary short.';}const match=String(run.input.message).match(/(?:name|call)(?: it| this agent)? ["“]?([^"”\n.]{2,70})/i);if(match)spec.name=match[1];}else{if(/retry|twice/.test(text))spec.nodes=spec.nodes.map((n:WorkflowNode)=>n.type==='agent'?{...n,retries:2}:n);if(/short|concise/.test(text)){const normalize=spec.nodes.find((n:WorkflowNode)=>n.id==='normalize');if(normalize)normalize.config.value.length='short';}spec.description=run.input.message.slice(0,2000);}summary='Demo edit applied using deterministic rules. Connect an on-prem model for unrestricted conversational building.';}
  else {const schema=z.toJSONSchema(isAgent?AgentSchema:WorkflowSchema);const agents=await this.db.entities('agent');const models=await this.db.query('SELECT config FROM models');const context={definition:run.snapshot,availableAgents:agents.filter(a=>a.publishedVersion).map(a=>({id:a.id,name:a.draft.name,version:a.publishedVersion})),models:models.map(r=>({id:r.config.id,name:r.config.name})),nodeTypes:['manual','webhook','schedule','agent','http','map','condition','merge','foreach','output']};const {value}=await structuredCompletion(this.db,model,[{role:'system',content:`You are the Agent Studio builder. Return the complete updated ${isAgent?'AgentSpec':'WorkflowSpec'} as JSON. Preserve existing stable IDs and unrelated settings. Never execute code or add tools. Use only available agent versions and model IDs. Field mappings use {"$ref":"input.emails"} or {"$ref":"nodes.nodeId.field"}. Workflow nodes form an acyclic graph with one trigger and one output. Conditions use true/false sourcePort edges. Agents must use JSON Schema. Output schema: ${JSON.stringify(schema)}`},...run.input.history.map((m:any)=>({role:m.role,content:m.text})),{role:'user',content:JSON.stringify({context,request:run.input.message})}],schema,signal,text=>emit('builder_delta',{text}));spec=value;}
  await emit('activity',{message:'Validating the updated definition'});spec=isAgent?validateAgent(spec):validateWorkflow(spec);signal.throwIfAborted();await this.db.owned(run.id,owner,async q=>{await this.db.save(run.entityId,run.input.revision,spec,q);await q('INSERT INTO conversations(id,entity_id,role,text) VALUES($1,$2,$3,$4)',[randomUUID(),run.entityId,'assistant',summary]);});await emit('activity',{message:'Preview updated'});return {spec,summary,demo:model.demo};
 }
}

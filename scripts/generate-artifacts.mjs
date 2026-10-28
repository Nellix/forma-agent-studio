import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {AgentSchema,WorkflowSchema,ModelSchema} from '../dist/shared/types.js';
import {emailAgent,inboxWorkflow,sampleEmails} from '../dist/shared/templates.js';
await mkdir('examples',{recursive:true});await mkdir('docs',{recursive:true});
for(const [name,value] of Object.entries({'email-summary.agent':emailAgent,'inbox-digest.workflow':inboxWorkflow,'sample-emails':{emails:sampleEmails,length:'medium',language:'English'}}))await writeFile(`examples/${name}.json`,JSON.stringify(value,null,2)+'\n');
const json=(schema)=>({'application/json':{schema}});
const object={type:'object',additionalProperties:true};
const ref=name=>({$ref:`#/components/schemas/${name}`});
const id={name:'id',in:'path',required:true,schema:{type:'string'}};
const version={name:'version',in:'path',required:true,schema:{type:'integer',minimum:1}};
const operation=(summary,body,response=object,parameters=[])=>({summary,parameters,...(body?{requestBody:{required:true,content:json(body)}}:{}),responses:{'200':{description:'Successful response',content:json(response)},'401':{description:'Authentication required'},'409':{description:'Revision or idempotency conflict'},'422':{description:'Invalid input or configuration'}}});
const paths={};
for(const plural of ['agents','workflows']){
 const name=plural==='agents'?'AgentSpec':'WorkflowSpec';
 paths[`/api/${plural}`]={get:operation(`List ${plural}`,null,{type:'array',items:object}),post:operation(`Create ${plural==='agents'?'agent':'workflow'}`,{type:'object',properties:{name:{type:'string'},spec:ref(name)}})};
 paths[`/api/${plural}/{id}`]={get:operation('Read draft, versions, and conversation',null,object,[id]),put:operation('Save draft with optimistic revision',{type:'object',required:['revision','spec'],properties:{revision:{type:'integer'},spec:ref(name)}},object,[id])};
 paths[`/api/${plural}/{id}/publish`]={post:operation('Publish an immutable version',{type:'object',required:['revision'],properties:{revision:{type:'integer'}}},{type:'object',properties:{version:{type:'integer'}}},[id])};
 paths[`/api/${plural}/{id}/versions/{version}`]={get:operation('Read an immutable published definition',null,ref(name),[id,version])};
 paths[`/api/${plural}/{id}/build`]={post:operation('Enqueue conversational builder edit',{type:'object',required:['message','revision'],properties:{message:{type:'string'},revision:{type:'integer'},modelId:{type:'string'}}},object,[id])};
 for(const suffix of ['/runs','/versions/{version}/runs']){const op=operation('Enqueue execution',{type:'object',required:['input'],properties:{input:object,modelId:{type:'string'}}},ref('Run'),[id,...(suffix.includes('version')?[version]:[]),{name:'Idempotency-Key',in:'header',schema:{type:'string'}}]);op.responses['202']=op.responses['200'];delete op.responses['200'];paths[`/api/${plural}/{id}${suffix}`]={post:op};}
}
paths['/api/workflows/{id}/active']={post:operation('Activate or deactivate a published trigger',{type:'object',required:['active'],properties:{active:{type:'boolean'}}},object,[id])};
paths['/api/hooks/{id}']={post:operation('Enqueue an activated webhook workflow',object,{type:'object',properties:{runId:{type:'string'},statusUrl:{type:'string'}}},[id])};paths['/api/hooks/{id}'].post.responses['202']=paths['/api/hooks/{id}'].post.responses['200'];delete paths['/api/hooks/{id}'].post.responses['200'];
paths['/api/runs']={get:operation('List recent workspace runs',null,{type:'array',items:ref('Run')},[{name:'entityId',in:'query',schema:{type:'string'}}])};
paths['/api/runs/{id}']={get:operation('Read execution result and node attempts',null,ref('Run'),[id])};
paths['/api/runs/{id}/cancel']={post:operation('Request cancellation',object,object,[id])};
paths['/api/runs/{id}/events']={get:{summary:'Stream durable execution events',parameters:[id,{name:'Last-Event-ID',in:'header',schema:{type:'integer'}}],responses:{'200':{description:'Server-sent events with monotonic IDs. Reconnect with Last-Event-ID.',content:{'text/event-stream':{schema:{type:'string'}}}}}}};
paths['/api/models']={get:operation('List endpoint configurations',null,{type:'array',items:ref('ModelConfig')})};
paths['/api/models/{id}']={put:operation('Save endpoint configuration',ref('ModelConfig'),ref('ModelConfig'),[id])};
for(const action of ['test','discover'])paths[`/api/models/{id}/${action}`]={post:operation(`${action} model endpoint`,object,object,[id])};
paths['/api/settings/default-model']={put:operation('Choose workspace default',{type:'object',required:['id'],properties:{id:{type:'string'}}})};
paths['/api/secrets']={get:operation('List credential reference names only',null,{type:'array',items:{type:'object',properties:{name:{type:'string'}}}})};
paths['/api/secrets/{id}']={put:operation('Encrypt and store a credential',{type:'object',required:['value'],properties:{value:{type:'string',writeOnly:true}}},object,[id])};
const spec={openapi:'3.1.0',info:{title:'Forma Agent Studio API',version:'0.1.0',description:'Single-workspace on-prem agent and native workflow API. Runner tokens can access published execution endpoints, webhooks, and workspace runs; administration requires the administrator token or browser session.'},servers:[{url:'/'}],security:[{bearerAuth:[]},{sessionCookie:[]}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'},sessionCookie:{type:'apiKey',in:'cookie',name:'studio_session'}},schemas:{AgentSpec:z.toJSONSchema(AgentSchema),WorkflowSpec:z.toJSONSchema(WorkflowSchema),ModelConfig:z.toJSONSchema(ModelSchema),Run:{type:'object',required:['id','kind','state'],properties:{id:{type:'string'},kind:{type:'string'},entityId:{type:'string'},version:{type:['integer','null']},state:{enum:['queued','running','completed','failed','cancelled','uncertain']},input:{},output:{},error:{type:['string','null']},resolved:object,snapshot:object,nodes:{type:'array',items:object}}}}}};
await writeFile('docs/openapi.json',JSON.stringify(spec,null,2)+'\n');console.log('Generated OpenAPI definition and independent sample templates.');

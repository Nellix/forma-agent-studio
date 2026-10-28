import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {CronExpressionParser} from 'cron-parser';
import {AgentSchema,WorkflowSchema,type WorkflowSpec,type Schema,type WorkflowNode} from '../shared/types.js';
import {HttpError} from './db.js';
const ajv=new (Ajv as any)({allErrors:true,strict:false,validateFormats:true});(addFormats as any)(ajv);
export function validateData(schema:Schema,value:any,label='Input'){let fn;try{fn=ajv.compile(schema);}catch{throw new HttpError(422,`${label} schema is invalid`);}if(!fn(value))throw new HttpError(422,`${label}: ${ajv.errorsText(fn.errors)}`);}
export function validateAgent(value:any){const s=AgentSchema.parse(value);try{ajv.compile(s.inputSchema);ajv.compile(s.outputSchema);}catch{throw new HttpError(422,'Invalid JSON Schema');}return s;}
export function refPaths(value:any):string[]{if(!value||typeof value!=='object')return [];if(typeof value.$ref==='string')return [value.$ref];if(typeof value.$template==='string')return Array.from(value.$template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g),(match:any)=>match[1]);return Object.values(value).flatMap(refPaths);}
export function getPath(value:any,path:string){if(path==='')return value;for(const part of path.split('.')){if(['__proto__','constructor','prototype'].includes(part))throw new HttpError(422,'Unsafe field reference');if(value===null||value===undefined||!Object.prototype.hasOwnProperty.call(value,part))throw new HttpError(422,`Field not found: ${path}`);value=value[part];}return value;}
export function mapValue(value:any,context:any):any{
 if(Array.isArray(value))return value.map(x=>mapValue(x,context));
 if(value&&typeof value==='object'){
  if(Object.keys(value).length===1&&typeof value.$ref==='string')return structuredClone(getPath(context,value.$ref));
  if(Object.keys(value).length===1&&typeof value.$template==='string')return value.$template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g,(_:string,path:string)=>{const v=getPath(context,path);return typeof v==='object'?JSON.stringify(v):String(v);});
  return Object.fromEntries(Object.entries(value).map(([k,v])=>{if(['__proto__','constructor','prototype'].includes(k))throw new HttpError(422,'Unsafe field name');return [k,mapValue(v,context)];}));
 }return value;
}
export function condition(left:any,operator:string,right:any){switch(operator){case 'equals':return JSON.stringify(left)===JSON.stringify(right);case 'notEquals':return JSON.stringify(left)!==JSON.stringify(right);case 'greaterThan':return typeof left==='number'&&typeof right==='number'&&left>right;case 'lessThan':return typeof left==='number'&&typeof right==='number'&&left<right;case 'contains':return (typeof left==='string'||Array.isArray(left))&&left.includes(right);case 'notEmpty':return left!==null&&left!==undefined&&(Array.isArray(left)||typeof left==='string'?left.length>0:typeof left==='object'?Object.keys(left).length>0:Boolean(left));case 'exists':return left!==null&&left!==undefined;default:throw new HttpError(422,'Unsupported condition operator');}}
export function validateWorkflow(value:any,depth=0):WorkflowSpec{
 const s=WorkflowSchema.parse(value);if(depth>3)throw new HttpError(422,'For Each nesting is limited to three levels');
 try{ajv.compile(s.inputSchema);ajv.compile(s.outputSchema);}catch{throw new HttpError(422,'Invalid workflow JSON Schema');}
 const nodes=new Map(s.nodes.map(n=>[n.id,n]));if(nodes.size!==s.nodes.length)throw new HttpError(422,'Node IDs must be unique');
 const roots=s.nodes.filter(n=>['manual','webhook','schedule'].includes(n.type));if(roots.length!==1)throw new HttpError(422,'A workflow needs exactly one trigger');
 if(s.nodes.filter(n=>n.type==='output').length!==1)throw new HttpError(422,'A workflow needs exactly one Output node');
 const seenEdges=new Set<string>();
 for(const e of s.edges){if(!nodes.has(e.source)||!nodes.has(e.target)||e.source===e.target)throw new HttpError(422,'Invalid connection');const k=`${e.source}/${e.sourcePort}/${e.target}`;if(seenEdges.has(k))throw new HttpError(422,'Duplicate connection');seenEdges.add(k);if(nodes.get(e.source)!.type==='condition' ? e.sourcePort==='default' : e.sourcePort!=='default')throw new HttpError(422,'Connect conditions using True or False ports');if(nodes.get(e.source)!.type==='output'||roots[0].id===e.target)throw new HttpError(422,'Invalid trigger or output connection');}
 const done=new Set<string>();while(done.size<nodes.size){const ready=s.nodes.filter(n=>!done.has(n.id)&&s.edges.filter(e=>e.target===n.id).every(e=>done.has(e.source)));if(!ready.length)throw new HttpError(422,'Cycles are not supported. Use For Each for iteration.');for(const n of ready)done.add(n.id);}
 const ancestors=(id:string):Set<string>=>{const found=new Set<string>();const visit=(v:string)=>{for(const e of s.edges.filter(e=>e.target===v)){if(!found.has(e.source)){found.add(e.source);visit(e.source);}}};visit(id);return found;};
 for(const n of s.nodes){const upstream=ancestors(n.id);if(n.id!==roots[0].id&&!upstream.has(roots[0].id))throw new HttpError(422,`${n.name} is disconnected from the trigger`);for(const p of refPaths(Object.fromEntries(Object.entries(n.config).filter(([key])=>key!=='body'||n.type!=='foreach')))){if(!/^(input|nodes|item)(\.[\w-]+)*$/.test(p)||p.split('.').some(x=>['__proto__','constructor','prototype'].includes(x)))throw new HttpError(422,`Invalid reference: ${p}`);if(p.startsWith('nodes.')&&!upstream.has(p.split('.')[1]))throw new HttpError(422,`${n.name} references a node that is not upstream`);}
  const c=n.config as any;
  if(n.type==='agent'&&(!c.agentId||!Number.isInteger(c.version)||c.version<1))throw new HttpError(422,`${n.name}: select a published agent version`);
  if(n.type==='condition'&&!['equals','notEquals','greaterThan','lessThan','contains','notEmpty','exists'].includes(c.operator))throw new HttpError(422,`${n.name}: choose a condition operator`);
  if(n.type==='http'){if(typeof c.url!=='string')throw new HttpError(422,'HTTP URL is required');if(!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(c.method??'GET'))throw new HttpError(422,'Unsupported HTTP method');if(n.retries>0&&!safeToRetry(n))throw new HttpError(422,'Side-effecting HTTP retries require an idempotency header');}
  if(n.type==='foreach'){if(!c.body)throw new HttpError(422,'For Each needs a body workflow');validateWorkflow(c.body,depth+1);if(!Number.isInteger(c.maxItems)||c.maxItems<1||c.maxItems>1000||!Number.isInteger(c.concurrency)||c.concurrency<1||c.concurrency>8)throw new HttpError(422,'For Each needs maxItems (1–1000) and concurrency (1–8)');}
  if(n.type==='schedule'){try{CronExpressionParser.parse(c.cron,{tz:c.timezone});new Intl.DateTimeFormat('en',{timeZone:c.timezone});}catch{throw new HttpError(422,'Invalid schedule or timezone');}}
 }
 return s;
}
export function safeToRetry(n:WorkflowNode){return n.type!=='http'||['GET','HEAD'].includes(String(n.config.method??'GET'))||Boolean(n.config.idempotencyHeader);}

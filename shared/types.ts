import {z} from 'zod';
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type Schema = Record<string, unknown>;
const schema = z.record(z.string(), z.unknown());
export const AgentSchema = z.object({
  name:z.string().min(1).max(120), description:z.string().max(2000), instructions:z.string().min(1).max(30000),
  inputSchema:schema,outputSchema:schema,modelId:z.string().nullable().default(null),
  temperature:z.number().min(0).max(2).default(0.2), maxTokens:z.number().int().min(64).max(32768).default(4096),
  tools:z.array(z.string()).max(0).default([]),examples:z.array(schema).max(20).default([]),
  preview:z.object({groupBySender:z.boolean(),concise:z.boolean()}).default({groupBySender:false,concise:false})
});
export type AgentSpec = z.infer<typeof AgentSchema>;
export const nodeTypes = ['manual','webhook','schedule','agent','http','map','condition','merge','foreach','output'] as const;
export type NodeType = typeof nodeTypes[number];
export const NodeSchema = z.object({id:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),type:z.enum(nodeTypes),version:z.literal(1).default(1),name:z.string().min(1).max(120),position:z.object({x:z.number(),y:z.number()}),config:schema.default({}),timeoutMs:z.number().int().min(100).max(600000).default(120000),retries:z.number().int().min(0).max(5).default(0)});
export const WorkflowSchema = z.object({schemaVersion:z.literal(1),name:z.string().min(1).max(120),description:z.string().max(2000),inputSchema:schema,outputSchema:schema,modelId:z.string().nullable().default(null),nodes:z.array(NodeSchema).min(2).max(100),edges:z.array(z.object({id:z.string(),source:z.string(),target:z.string(),sourcePort:z.enum(['default','true','false']).default('default')})).max(400)});
export type WorkflowSpec = z.infer<typeof WorkflowSchema>;
export type WorkflowNode = z.infer<typeof NodeSchema>;
export type EntityKind = 'agent'|'workflow';
export type Entity = {id:string;kind:EntityKind;draft:AgentSpec|WorkflowSpec;revision:number;publishedVersion:number|null;active:boolean;updatedAt:string};
export type RunKind = 'agent'|'workflow'|'builder-agent'|'builder-workflow';
export type RunState = 'queued'|'running'|'completed'|'failed'|'cancelled'|'uncertain';
export type Run = {id:string;kind:RunKind;entityId:string;version:number|null;state:RunState;input:any;output:any;error:string|null;createdAt:string;startedAt:string|null;finishedAt:string|null;cancelRequested:boolean;resolved:any;snapshot:any;leaseOwner?:string|null};
export const ModelSchema = z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80),name:z.string().min(1).max(120),baseUrl:z.string().max(2048),model:z.string().min(1).max(200),secretRef:z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable().default(null),enabled:z.boolean().default(true),streaming:z.boolean().default(false),structuredOutput:z.enum(['none','json','schema']).default('none'),toolCalling:z.boolean().default(false),timeoutMs:z.number().int().min(1000).max(600000).default(120000),maxConcurrent:z.number().int().min(1).max(32).default(4),contextTokens:z.number().int().min(1024).default(32768),demo:z.boolean().default(false)});
export type ModelConfig = z.infer<typeof ModelSchema>;
export type ConversationMessage = {id:string;role:'user'|'assistant';text:string;createdAt:string};

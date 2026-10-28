import {Pool} from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import type {Entity,EntityKind,Run,RunKind} from '../shared/types.js';
export type Query = <T=any>(sql:string,params?:any[])=>Promise<T[]>;
const migration = `
CREATE TABLE IF NOT EXISTS studio_migrations (version integer PRIMARY KEY, applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS entities (id text PRIMARY KEY,kind text NOT NULL,draft jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,published_version integer,active boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS versions (entity_id text REFERENCES entities(id),version integer NOT NULL,spec jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(entity_id,version));
CREATE TABLE IF NOT EXISTS models (id text PRIMARY KEY,config jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (name text PRIMARY KEY,ciphertext text NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id text PRIMARY KEY,entity_id text REFERENCES entities(id),role text NOT NULL,text text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY,kind text NOT NULL,entity_id text NOT NULL,version integer,state text NOT NULL DEFAULT 'queued',input jsonb NOT NULL,snapshot jsonb NOT NULL,resolved jsonb NOT NULL,output jsonb,error text,idempotency_key text UNIQUE,request_hash text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,cancel_requested boolean NOT NULL DEFAULT false,lease_owner text,lease_until timestamptz);
CREATE INDEX IF NOT EXISTS runs_queue ON runs (state,created_at);
CREATE TABLE IF NOT EXISTS node_runs (run_id text REFERENCES runs(id),node_id text NOT NULL,state text NOT NULL,attempt integer NOT NULL DEFAULT 0,output jsonb,error text,started_at timestamptz,finished_at timestamptz,PRIMARY KEY(run_id,node_id));
CREATE TABLE IF NOT EXISTS events (id bigserial PRIMARY KEY,run_id text REFERENCES runs(id),type text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_run ON events(run_id,id);
CREATE TABLE IF NOT EXISTS schedules (entity_id text PRIMARY KEY REFERENCES entities(id),next_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS model_slots (id text PRIMARY KEY,model_id text NOT NULL,expires_at timestamptz NOT NULL);
INSERT INTO studio_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;
const entity=(r:any):Entity=>({id:r.id,kind:r.kind,draft:r.draft,revision:r.revision,publishedVersion:r.published_version,active:r.active,updatedAt:r.updated_at});
export const toRun=(r:any):Run=>({id:r.id,kind:r.kind,entityId:r.entity_id,version:r.version,state:r.state,input:r.input,snapshot:r.snapshot,resolved:r.resolved,output:r.output,error:r.error,createdAt:r.created_at,startedAt:r.started_at,finishedAt:r.finished_at,cancelRequested:r.cancel_requested,leaseOwner:r.lease_owner});
export class DB {
  pool?:Pool; embedded?:PGlite; private tail=Promise.resolve();
  constructor(public url:string){}
  async open(){
    if(this.url.startsWith('pglite://')){const path=this.url.slice(9);if(path && path!==':memory:')await mkdir(path,{recursive:true});this.embedded=new PGlite(path===':memory:'?undefined:path);await this.embedded.waitReady;await this.embedded.exec(migration);}
    else {this.pool=new Pool({connectionString:this.url,max:15});const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(537193)');await client.query(migration);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
    return this;
  }
  private async lock<T>(fn:()=>Promise<T>):Promise<T>{let release!:()=>void;const prev=this.tail;this.tail=new Promise<void>(r=>release=r);await prev;try{return await fn();}finally{release();}}
  query:Query=async<T=any>(sql:string,params:any[]=[])=>{
    if(this.pool)return (await this.pool.query(sql,params)).rows as T[];
    return this.lock(async()=> (await this.embedded!.query<T>(sql,params)).rows);
  };
  async transaction<T>(fn:(q:Query)=>Promise<T>):Promise<T>{
    if(this.pool){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await fn(async(s,p)=>(await c.query(s,p)).rows);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
    return this.lock(()=>this.embedded!.transaction(tx=>fn(async(s,p)=>(await tx.query(s,p)).rows as any)));
  }
  async close(){await this.pool?.end();await this.embedded?.close();}
  async entities(kind?:EntityKind){return (await this.query('SELECT * FROM entities WHERE ($1::text IS NULL OR kind=$1) ORDER BY updated_at DESC',[kind??null])).map(entity);}
  async entity(id:string){const [r]=await this.query('SELECT * FROM entities WHERE id=$1',[id]);if(!r)throw new HttpError(404,'Project not found');return entity(r);}
  async create(kind:EntityKind,spec:any,id=randomUUID()){const [r]=await this.query('INSERT INTO entities(id,kind,draft) VALUES($1,$2,$3) RETURNING *',[id,kind,JSON.stringify(spec)]);return entity(r);}
  async save(id:string,revision:number,spec:any,q=this.query){const [r]=await q('UPDATE entities SET draft=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',[id,revision,JSON.stringify(spec)]);if(!r)throw new HttpError(409,'This draft changed. Reload before applying your edit.');return entity(r);}
  async publish(id:string,expectedRevision?:number){return this.transaction(async q=>{const [r]=await q('SELECT * FROM entities WHERE id=$1 FOR UPDATE',[id]);if(!r)throw new HttpError(404,'Project not found');if(expectedRevision!==undefined&&r.revision!==expectedRevision)throw new HttpError(409,'Draft changed during publishing. Review and publish again.');const v=(r.published_version??0)+1;await q('INSERT INTO versions(entity_id,version,spec) VALUES($1,$2,$3)',[id,v,JSON.stringify(r.draft)]);await q('UPDATE entities SET published_version=$2,active=false,updated_at=now() WHERE id=$1',[id,v]);await q('DELETE FROM schedules WHERE entity_id=$1',[id]);return v;});}
  async version(id:string,v:number){const [r]=await this.query('SELECT spec FROM versions WHERE entity_id=$1 AND version=$2',[id,v]);if(!r)throw new HttpError(404,'Published version not found');return r.spec;}
  async enqueue(kind:RunKind,id:string,version:number|null,input:any,snapshot:any,resolved:any,key?:string,hash?:string){
    const rid=randomUUID();const [r]=await this.query('INSERT INTO runs(id,kind,entity_id,version,input,snapshot,resolved,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *',[rid,kind,id,version,JSON.stringify(input),JSON.stringify(snapshot),JSON.stringify(resolved),key??null,hash??null]);
    if(r)return toRun(r);const [old]=await this.query('SELECT * FROM runs WHERE idempotency_key=$1',[key]);if(old.request_hash!==hash)throw new HttpError(409,'Idempotency key was already used with different input.');return toRun(old);
  }
  async run(id:string){const [r]=await this.query('SELECT * FROM runs WHERE id=$1',[id]);if(!r)throw new HttpError(404,'Execution not found');return toRun(r);}
  async claim(owner:string){const [r]=await this.query(`UPDATE runs SET state='running',lease_owner=$1,lease_until=now()+interval '30 seconds',started_at=COALESCE(started_at,now()) WHERE id=(SELECT id FROM runs WHERE state='queued' OR (state='running' AND lease_until < now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[owner]);return r?toRun(r):null;}
  async owned<T>(id:string,owner:string,fn:(q:Query)=>Promise<T>){return this.transaction(async q=>{const [r]=await q('SELECT id FROM runs WHERE id=$1 AND lease_owner=$2 AND state=$3 AND lease_until>now() FOR UPDATE',[id,owner,'running']);if(!r)throw new Error('Execution lease lost');return fn(q);});}
  async event(id:string,type:string,data:any,q=this.query){await q('INSERT INTO events(run_id,type,data) VALUES($1,$2,$3)',[id,type,JSON.stringify(data)]);}
  async setting(key:string,fallback:any=null){const [r]=await this.query('SELECT value FROM settings WHERE key=$1',[key]);return r?.value??fallback;}
  async setSetting(key:string,value:any){await this.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,JSON.stringify(value)]);}
}
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}

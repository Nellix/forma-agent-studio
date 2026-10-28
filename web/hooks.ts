import {useCallback,useEffect,useRef,useState} from 'react';
import {api,put,post} from './api';
import type {Entity,EntityKind,Run} from '../shared/types';
export function useProject(kind:EntityKind,id:string,onError:(message:string)=>void){
 const base=`/${kind==='agent'?'agents':'workflows'}/${id}`;
 const [entity,setEntity]=useState<any>(null);const [draft,setDraft]=useState<any>(null);const [dirty,setDirty]=useState(false);const [saving,setSaving]=useState(false);const [saveError,setSaveError]=useState('');const revision=useRef(0);const current=useRef<any>(null);const changed=useRef(0);const saved=useRef(0);const pending=useRef<Promise<void>|null>(null);const undo=useRef<any[]>([]);const redo=useRef<any[]>([]);
 const load=useCallback(async()=>{const e=await api(base);setEntity(e);revision.current=e.revision;current.current=e.draft;setDraft(e.draft);saved.current=changed.current;setDirty(false);return e;},[base]);
 useEffect(()=>{undo.current=[];redo.current=[];void load().catch(e=>onError(e.message));},[load]);
 const update=useCallback((spec:any,history=true)=>{if(history&&current.current){undo.current.push(structuredClone(current.current));if(undo.current.length>50)undo.current.shift();redo.current=[];}current.current=spec;changed.current++;setDraft(spec);setDirty(true);setSaveError('');},[]);
 const flush=useCallback(async()=>{
  if(pending.current)await pending.current;if(saved.current===changed.current)return;
  const work=async()=>{setSaving(true);try{while(saved.current!==changed.current){const version=changed.current;const spec=structuredClone(current.current);const e=await put<Entity>(base,{spec,revision:revision.current});revision.current=e.revision;saved.current=version;setEntity((old:any)=>({...old,...e}));}setDirty(false);setSaveError('');}catch(e){setSaveError((e as Error).message);throw e;}finally{setSaving(false);pending.current=null;}};
  pending.current=work();await pending.current;
 },[base]);
 useEffect(()=>{if(!dirty||saveError)return;const timer=setTimeout(()=>{void flush().catch(e=>onError(e.message));},800);return()=>clearTimeout(timer);},[dirty,draft,flush,saveError]);
 const undoChange=()=>{const previous=undo.current.pop();if(previous){redo.current.push(structuredClone(current.current));update(previous,false);}};
 const redoChange=()=>{const next=redo.current.pop();if(next){undo.current.push(structuredClone(current.current));update(next,false);}};
 const remember=()=>undo.current.push(structuredClone(current.current));
 const publish=async()=>{await flush();const r=await post(base+'/publish',{revision:revision.current});await load();return r.version;};
 return {base,entity,draft,update,load,flush,publish,dirty,saving,saveError,undoChange,redoChange,remember,revision};
}
export function useRun(id:string|null){
 const [run,setRun]=useState<any>(null);const [events,setEvents]=useState<any[]>([]);
 useEffect(()=>{
  setRun(null);setEvents([]);if(!id)return;
  let gone=false;let refreshing=false;let terminal=false;
  const source=new EventSource('/api/runs/'+id+'/events');
  const refresh=async()=>{
   if(refreshing||gone||terminal)return;refreshing=true;
   try{const r=await api('/runs/'+id);if(!gone){setRun(r);if(!['queued','running'].includes(r.state)){terminal=true;source.close();}}}
   catch{/* Reconnect through the polling fallback after a temporary network failure. */}
   finally{refreshing=false;}
  };
  source.onmessage=event=>{if(gone)return;try{const data=JSON.parse(event.data);setEvents(prev=>[...prev.slice(-100),data]);if(data.type!=='builder_delta')void refresh();}catch{/* Ignore a malformed event and rely on the persisted run. */}};
  void refresh();const timer=setInterval(()=>void refresh(),1500);
  return()=>{gone=true;clearInterval(timer);source.close();};
 },[id]);
 return {run,events};
}

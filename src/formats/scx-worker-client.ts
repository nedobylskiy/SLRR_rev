import {parseScx,type ScxModel} from './scx';
import type {ScxParseReply} from './scx-worker-protocol';

type Job={bytes:Uint8Array;resolve:(model:ScxModel)=>void;reject:(error:Error)=>void};
/** One lazy worker per viewer; no parser/geometry objects cross the thread boundary. */
export class ScxWorkerClient {
  private worker?:Worker;
  private unavailable=false;
  private disposed=false;
  private nextId=0;
  private pending=new Map<number,Job>();
  constructor(private readonly createWorker:()=>Worker|undefined=()=>typeof Worker==='undefined'?undefined:new Worker(new URL('../workers/scx-parser-worker.ts',import.meta.url),{type:'module',name:'SCX parser'})){}
  async parse(bytes:Uint8Array):Promise<ScxModel>{
    if(this.disposed)throw Error('SCX parser disposed');
    if(this.unavailable)return parseScx(bytes);
    if(!this.worker){
      try{
        const worker=this.createWorker();
        if(!worker){this.unavailable=true;return parseScx(bytes);}
        this.worker=worker;
        worker.onmessage=(event:MessageEvent<ScxParseReply>)=>{
          if(this.worker!==worker)return;
          const reply=event.data,job=this.pending.get(reply.id);if(!job)return;
          this.pending.delete(reply.id);
          if('model' in reply)job.resolve(reply.model);else job.reject(Error(reply.error));
        };
        worker.onerror=event=>{event.preventDefault();this.failWorker(worker);};
        worker.onmessageerror=()=>this.failWorker(worker);
      }catch{this.unavailable=true;return parseScx(bytes);}
    }
    const worker=this.worker!;
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;this.pending.set(id,{bytes,resolve,reject});
      try{
        // Asset readers may cache/shared-own the source view. Detach only our copy.
        const owned=Uint8Array.from(bytes);
        worker.postMessage({id,bytes:owned},[owned.buffer]);
      }catch{this.failWorker(worker);}
    });
  }
  private failWorker(worker:Worker){
    if(this.worker!==worker)return;
    worker.terminate();this.worker=undefined;this.unavailable=true;
    const jobs=[...this.pending.values()];this.pending.clear();
    for(const job of jobs)try{job.resolve(parseScx(job.bytes));}catch(error){job.reject(error instanceof Error?error:Error(String(error)));}
  }
  dispose(){
    this.disposed=true;this.worker?.terminate();this.worker=undefined;
    for(const job of this.pending.values())job.reject(Error('SCX parser disposed'));
    this.pending.clear();
  }
}

// Application-lifetime service shared by render, collision and resource helpers.
// The worker starts lazily; browsers release it with the owning page.
const sharedScxParser=new ScxWorkerClient();
export const parseScxAsync=(bytes:Uint8Array)=>sharedScxParser.parse(bytes);

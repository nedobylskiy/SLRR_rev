import type {AgentRequest,AgentResult,BodyState} from './agent-worker-protocol';
import type {RigidBody3D} from './rigid-body-3d';
export function agentBody(body:RigidBody3D):BodyState{return {position:body.position.toArray(),orientation:body.orientation.toArray(),velocity:body.velocity.toArray(),omega:body.omega.toArray(),min:body.bounds.min.toArray(),max:body.bounds.max.toArray(),center:body.center.toArray(),mass:body.mass};}
/** Single in-flight snapshot. Render/physics never await a worker and no stale request queue can build up. */
export class AgentWorkerClient {
  private worker?:Worker;private busy=false;private result?:AgentResult;private sent=0;private sequence=0;private pending=0;
  error='';
  workMs=0;roundTripMs=0;
  private responseAt=performance.now();
  get stale(){return performance.now()-this.responseAt>250;}
  get available(){return !!this.worker;}
  ready(now:number){if(this.busy&&now-this.sent>2000)this.fail('Agent worker response timed out');return !!this.worker&&!this.busy&&now-this.sent>=1000/30;}
  constructor(init:AgentRequest,create=()=>typeof Worker==='undefined'?undefined:new Worker(new URL('../workers/agent-worker.ts',import.meta.url),{type:'module',name:init.kind==='traffic-init'?'Traffic drivers':'Pedestrian movement'})){
    try{const worker=this.worker=create();if(!worker)return;
      worker.onmessage=event=>{if(this.worker!==worker)return;if(event.data.error){this.fail(String(event.data.error));return;}if(event.data.id!==this.pending)return;this.busy=false;this.responseAt=performance.now();this.workMs=event.data.workMs??0;this.roundTripMs=Math.max(0,this.responseAt-this.sent);this.result=event.data.result;};
      worker.onerror=event=>{event.preventDefault();if(this.worker===worker)this.fail(event.message||'Agent worker failed');};
      worker.onmessageerror=()=>{if(this.worker===worker)this.fail('Agent worker message could not be decoded');};
      worker.postMessage({id:0,request:init});
    }catch(error){this.fail(String(error));}
  }
  request(request:AgentRequest,now:number){
    if(!this.ready(now))return false;
    this.busy=true;this.sent=now;this.pending=++this.sequence;
    try{this.worker!.postMessage({id:this.pending,request});return true;}catch(error){this.fail(String(error));return false;}
  }
  take(){const result=this.result;this.result=undefined;return result;}
  private fail(error:string){this.error=error;this.dispose();console.warn('Background agents falling back to main thread:',error);}
  dispose(){this.worker?.terminate();this.worker=undefined;this.busy=false;this.result=undefined;}
}

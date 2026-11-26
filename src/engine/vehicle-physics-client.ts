import {MapTerrain} from './map-terrain';
import {VehiclePhysicsWorld} from './vehicle-physics-world';
import {Vehicle3D} from './vehicle-3d';
import {softBodyRuntime} from './soft-body-wasm';
import {applyPhysicsCar,createPhysicsSeed,packFields,packPhysics,unpackPhysics,type PhysicsControl,type PhysicsFields} from './vehicle-physics-transfer';
import type {DrivingInput} from './driving-demo';
import type {PhysicsRequest,PhysicsResponse,PhysicsScene} from './vehicle-physics-protocol';

interface Entry {
  id:number;car:Vehicle3D;input:DrivingInput;elapsed:number;version:number;commands:PhysicsControl['commands'];
  baseline:PhysicsFields;conditions:Map<number,number>;edges:DrivingInput;restore:(()=>void)[];impact?:(speed:number,time?:number)=>void;
}
/** Shared main-thread world; optional worker mode is retained for offline comparison. */
export class VehiclePhysicsClient {
  private worker?:Worker;private busy=false;private sequence=0;private nextId=1;private pending=0;
  private immediate=false;private stepped=false;
  beginFrame(){this.immediate=true;this.stepped=false;}
  /** Simulated time the shared clock holds short of a whole tick; 0 while a worker owns the clock. */
  get pendingSeconds(){return this.local?.clock.pendingSeconds??0;}
  cars(){return this.entries.keys();}
  private tickContacts?:()=>void;
  /** Per-tick external contacts (see VehiclePhysicsWorld.onTick); only the main-thread world can run them. */
  setTickContacts(contacts:(()=>void)|undefined){this.tickContacts=contacts;if(this.local)this.local.onTick=contacts;}
  get runsTickContacts(){return !!this.local&&!!this.tickContacts;}
  /** Hidden time is a pause, never work to catch up on after restoring the tab. */
  pause(){
    this.pending=this.pendingMs=0;
    for(const entry of this.entries.values())entry.elapsed=0;
    this.local?.pause();
    if(this.worker)this.post({kind:'pause'});
  }
  private entries=new Map<Vehicle3D,Entry>();private local?:VehiclePhysicsWorld;
  private sceneCollision?:Vehicle3D['mapCollision'];private sceneRevision=-1;private sentAt=0;
  workMs=0;roundTripMs=0;snapshotMs=0;pendingMs=0;error='';backend='Main thread / shared vehicle clock';
  constructor(private readonly create:()=>Worker|undefined=()=>undefined){}
  private start(car:Vehicle3D){
    try{
      this.worker=this.create();if(!this.worker){this.local=new VehiclePhysicsWorld(car.physicsFrequency);this.local.onTick=this.tickContacts;this.backend='Main thread · shared vehicle clock';return;}
      const activeWorker=this.worker;this.worker.onmessage=event=>{if(this.worker!==activeWorker)return;try{const response=event.data as PhysicsResponse;if(response.error){this.fail(response.error);return;}if(response.sequence!==this.sequence)return;
        const snapshotStart=performance.now();this.busy=false;this.workMs=response.workMs;this.roundTripMs=performance.now()-this.sentAt;this.pendingMs=response.pending*1000;this.backend=response.backend;
        for(const result of response.cars){const entry=[...this.entries.values()].find(e=>e.id===result.id);if(!entry||entry.version!==result.version)continue;
          const conditions=[...entry.car.root.world.parts.values()].filter(p=>p.condition!==entry.conditions.get(p.id)).map(p=>[p,p.condition] as const);const external=this.bodyDelta(entry);applyPhysicsCar(entry.car,result.state);entry.baseline=this.bodyFields(entry.car);entry.conditions=new Map([...entry.car.root.world.parts.values()].map(p=>[p.id,p.condition]));for(const [p,condition]of conditions)p.condition=condition;this.applyBodyDelta(entry.car,external);
          if(result.telemetry?.id===entry.car.telemetry.recordingId)entry.car.telemetry.acceptWorkerPacket(result.telemetry.packet);
        }
        for(const impact of response.impacts)[...this.entries.values()].find(e=>e.id===impact.id)?.impact?.(impact.speed,impact.time);
        this.snapshotMs=performance.now()-snapshotStart;
        for(const hit of response.interactions){const entry=[...this.entries.values()].find(e=>e.id===hit.id);if(entry)this.sceneCollision?.interactPhysicsBox(hit.box,entry.car.body,unpackPhysics(hit.hit));}
      }catch(error){this.fail(String(error));}};
      this.worker.onerror=event=>{event.preventDefault();if(this.worker!==activeWorker)return;this.fail(event.message||'Vehicle physics worker failed');};
      this.worker.onmessageerror=()=>{if(this.worker===activeWorker)this.fail('Invalid vehicle physics worker message');};
    }catch(error){this.fail(String(error));this.local=new VehiclePhysicsWorld(car.physicsFrequency);this.local.onTick=this.tickContacts;}
  }
  private bodyFields(car:Vehicle3D){return packFields(car.body,['position','velocity','momentum','orientation']);}
  private bodyDelta(entry:Entry):PhysicsFields{
    const current=this.bodyFields(entry.car),out:PhysicsFields={};
    for(const key of ['position','velocity','momentum']){const a=current[key].value,b=entry.baseline[key].value,delta=a.map((v:number,i:number)=>v-b[i]);if(delta.some((v:number)=>v!==0))out[key]=delta;}
    if(current.orientation.value.some((v:number,i:number)=>v!==entry.baseline.orientation.value[i]))out.orientation=current.orientation;
    return out;
  }
  private applyBodyDelta(car:Vehicle3D,delta:PhysicsFields){for(const key of ['position','velocity','momentum'] as const)if(delta[key]){car.body[key].x+=delta[key][0];car.body[key].y+=delta[key][1];car.body[key].z+=delta[key][2];}if(delta.orientation)car.body.orientation.copy(unpackPhysics(delta.orientation));}
  register(car:Vehicle3D,impact?:(speed:number,time?:number)=>void){
    const existing=this.entries.get(car);if(existing){if(impact)existing.impact=impact;return;}
    if(!this.entries.size)this.start(car);
    const entry:Entry={id:this.nextId++,car,input:{throttle:0,steer:0,brake:false},elapsed:0,version:0,commands:[],baseline:this.bodyFields(car),conditions:new Map([...car.root.world.parts.values()].map(p=>[p.id,p.condition])),edges:{throttle:0,steer:0,brake:false},restore:[],impact};
    this.entries.set(car,entry);
    if(this.local){this.local.add(entry.id,{car,input:entry.input,impact});return;}
    let scene:PhysicsScene|undefined;
    if(this.entries.size===1){this.sceneCollision=car.mapCollision;this.sceneRevision=car.mapCollision?.revision??0;scene={terrain:car.terrain instanceof MapTerrain?car.terrain.physicsSnapshot():undefined,walls:car.mapCollision?.physicsWalls()??[],boxes:car.mapCollision?.physicsBoxes()??[]};}
    this.post({kind:'add',id:entry.id,seed:createPhysicsSeed(car),scene});if(this.local)return;
    let nested=0;
    for(const name of ['reset','placeAt','settleSpawn','sleepPhysics','wakePhysics','jump','applyImpulse','vehicleContact','setChassisCrumple','disableObstacle','rearCrash','roll','dropOnRoof'] as const){
      const original=(car[name] as Function).bind(car);
      (car as any)[name]=(...args:any[])=>{
        if(nested)return original(...args);nested++;const before=this.bodyFields(car);
        try{const result=original(...args);entry.commands.push({method:name,args:args.map(arg=>arg instanceof Vehicle3D?undefined:packPhysics(arg))});entry.version++;
          const after=this.bodyFields(car);for(const key of ['position','velocity','momentum'])for(let i=0;i<3;i++)entry.baseline[key].value[i]+=after[key].value[i]-before[key].value[i];entry.baseline.orientation=after.orientation;
          return result;
        }finally{nested--;}
      };
      entry.restore.push(()=>{(car as any)[name]=original;});
    }
  }
  submit(car:Vehicle3D,seconds:number,input:DrivingInput){
    this.register(car);const entry=this.entries.get(car)!;entry.elapsed+=seconds;entry.input=seconds>0&&!this.local?(car.controlInput?.(seconds)??input):input;
    for(const key of ['gearUp','gearDown','neutral','start'] as const)if(entry.input[key])entry.edges[key]=true;
    if(this.local&&this.immediate&&!this.stepped&&seconds>0){for(const e of this.entries.values())this.local.entries.get(e.id)!.input=e.input;const start=performance.now(),result=this.local.advance(seconds);this.workMs=performance.now()-start;this.stepped=true;for(const e of this.entries.values())e.elapsed=0;return result;}
    return {steps:0,backlogTicks:Math.floor((this.pending+this.pendingMs/1000)/car.physicsDt),alpha:0};
  }
  flush(){
    const entries=[...this.entries.values()];this.pending+=Math.max(0,...entries.map(e=>e.elapsed));for(const e of entries)e.elapsed=0;
    if(this.local){if(!this.immediate||!this.stepped){for(const e of entries)this.local.entries.get(e.id)!.input=e.input;const start=performance.now();this.local.advance(this.pending);this.workMs=performance.now()-start;}this.pending=0;return;}
    if(this.busy){if(performance.now()-this.sentAt>10000)this.fail('Vehicle physics worker exceeded 10 seconds without a snapshot');return;}
    if(this.pending===0&&!entries.some(e=>e.commands.length))return;
    const controls:PhysicsControl[]=entries.map(e=>{
      const delta=this.bodyDelta(e);e.baseline=this.bodyFields(e.car);const conditions=[...e.car.root.world.parts.values()].filter(p=>p.condition!==e.conditions.get(p.id)).map(p=>[p.id,p.condition] as [number,number]);for(const [id,condition]of conditions)e.conditions.set(id,condition);const input={...e.input};for(const key of ['gearUp','gearDown','neutral','start'] as const){if(e.edges[key])input[key]=true;e.edges[key]=false;}
      return {id:e.id,version:e.version,input,conditions,settings:{...packFields(e.car.suspension,['helping','tireModel']),...(e.car.suspension.mechanics?{mechanics:packFields(e.car.suspension.mechanics,['helping','manual'])}:{})},carSettings:packFields(e.car,['obstacle']),ramp:e.car.terrain.ramp,commands:e.commands.splice(0),bodyDelta:delta,recording:e.car.telemetry.status.recording,recordingId:e.car.telemetry.recordingId};
    });
    const revision=this.sceneCollision?.revision??0,boxes=revision!==this.sceneRevision?this.sceneCollision?.physicsBoxes():undefined;this.sceneRevision=revision;
    const seconds=this.pending;this.pending=0;this.busy=true;this.sentAt=performance.now();this.post({kind:'step',sequence:++this.sequence,seconds,controls,boxes,backend:softBodyRuntime.preference});
  }
  private post(message:PhysicsRequest){try{this.worker?.postMessage(message);}catch(error){this.fail(String(error));}}
  private fail(message:string){
    this.error=message;this.worker?.terminate();this.worker=undefined;this.busy=false;
    this.backend='Main thread (worker failed)';console.error('Vehicle physics worker:',message);
    const first=this.entries.values().next().value as Entry|undefined;if(!first)return;
    this.local=new VehiclePhysicsWorld(first.car.physicsFrequency);this.local.onTick=this.tickContacts;for(const e of this.entries.values()){for(const restore of e.restore)restore();e.restore=[];e.car.syncRecordedPose();this.local.add(e.id,{car:e.car,input:e.input,impact:e.impact});}
  }
  forget(car:Vehicle3D){
    const entry=this.entries.get(car);if(!entry)return;for(const restore of entry.restore)restore();this.entries.delete(car);this.local?.entries.delete(entry.id);this.post({kind:'remove',id:entry.id});
    if(!this.entries.size){this.worker?.terminate();this.worker=undefined;this.local=undefined;this.pending=0;this.busy=false;this.sceneCollision=undefined;this.sceneRevision=-1;}
  }
  dispose(){for(const car of [...this.entries.keys()])this.forget(car);}
}

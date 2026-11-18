import {Box3,Matrix4,Quaternion,Vector3} from 'three';
import {EngineWorld,EnginePart,type PartDefinition} from './world';
import {Vehicle3D} from './vehicle-3d';
import type {DrivingInput} from './driving-demo';
import type {Terrain} from './suspension-3d';
import type {MapCollision} from './map-collision';

// Only data crosses the boundary. EnginePart links and functions are rebuilt,
// never cloned. Numeric arrays retain the existing WASM views when applied.
export type PhysicsFields=Record<string,any>;
export function packPhysics(value:any):any{
  if(value===null||['number','boolean','string'].includes(typeof value))return value;
  if(value===undefined)return undefined;
  if(value instanceof Vector3)return {$physics:'v3',value:value.toArray()};
  if(value instanceof Quaternion)return {$physics:'q',value:value.toArray()};
  if(value instanceof Matrix4)return {$physics:'m4',value:value.toArray()};
  if(value instanceof Box3)return {$physics:'box',min:value.min.toArray(),max:value.max.toArray()};
  if(ArrayBuffer.isView(value)&&!(value instanceof DataView))return (value as Float64Array).slice();
  if(Array.isArray(value))return value.map(packPhysics);
  if(Object.getPrototypeOf(value)===Object.prototype)return packFields(value);
}
export function packFields(value:object,keys=Object.keys(value)):PhysicsFields{
  const out:PhysicsFields={};for(const key of keys){const data=packPhysics((value as PhysicsFields)[key]);if(data!==undefined)out[key]=data;}return out;
}
export function unpackPhysics(value:any):any{
  if(value?.$physics==='v3')return new Vector3().fromArray(value.value);
  if(value?.$physics==='q')return new Quaternion().fromArray(value.value);
  if(value?.$physics==='m4')return new Matrix4().fromArray(value.value);
  if(value?.$physics==='box')return new Box3(new Vector3().fromArray(value.min),new Vector3().fromArray(value.max));
  if(Array.isArray(value))return value.map(unpackPhysics);
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unpackPhysics(v)]));
  return value;
}
export function applyFields(target:any,fields:PhysicsFields){
  for(const [key,value]of Object.entries(fields)){
    const current=target[key];
    if(ArrayBuffer.isView(current)&&ArrayBuffer.isView(value)){(current as any).set(value);continue;}
    if(value?.$physics){const data=unpackPhysics(value);if(current?.copy)current.copy(data);else target[key]=data;continue;}
    if(value&&Object.getPrototypeOf(value)===Object.prototype){if(current&&typeof current==='object')applyFields(current,value);else target[key]=unpackPhysics(value);continue;}
    if(Array.isArray(value)&&Array.isArray(current)){
      for(let i=0;i<value.length;i++){if(value[i]===undefined)continue;const cell={value:current[i]};applyFields(cell,{value:value[i]});current[i]=cell.value;}current.length=value.length;continue;
    }
    target[key]=value;
  }
}
const panelFields=['positions','velocities','rest','contacts','impulseVersion','resetVersion','shapeVersion','collisionImpact'];
const carFields=['impactSpeed','yawVelocity','reboundSpeed','lastVelocity','lastOmega','pendingShock','chassisCrumple','spawn','advanceVersion','sleeping','sleepWhenResting','sleepQuietSeconds'];
function beamState(panel:Vehicle3D['panel']){const values=new Float64Array(panel.beams.length*2);panel.beams.forEach((b,i)=>{values[i*2]=b.rest;values[i*2+1]=b.lambda;});return values;}
function mountState(panel:Vehicle3D['panel']){const values=new Float64Array(panel.mounts.length*3);panel.mounts.forEach((m,i)=>{values[i*3]=Number(m.broken);values[i*3+1]=m.force;values[i*3+2]=m.overload;});return values;}
const activityFields=['deforming','quietTicks','activeTicks','impulseVersion','frame','resting','sleepReason','internalSpeed','threatReason','restTicks'];
export function capturePhysicsCar(car:Vehicle3D){
  return {car:packFields(car,carFields),body:packFields(car.body),tick:car.clock.tick,pending:car.clock.pendingSeconds,
    parts:[...car.root.world.parts.values()].map(p=>({id:p.id,parent:p.parent?.id,parentSlot:p.parentSlot,ownSlot:p.ownSlot,condition:p.condition,fields:packFields(p,['local','steeringTransform','armTravelTransform','renderAdjustment'])})),
    soft:[...car.soft.values()].map(s=>({id:s.part.id,panel:packFields(s.panel,panelFields),tick:s.panel.clock.tick,pending:s.panel.clock.pendingSeconds,beams:beamState(s.panel),mounts:mountState(s.panel),activity:packFields(s.activity,activityFields),free:s.activity.freeBody?packFields(s.activity.freeBody):undefined})),
    rigid:[...car.rigid.values()].map(r=>({id:r.part.id,body:packFields(r.body),previous:packPhysics(r.previous),peakForce:r.peakForce})),
    suspension:packFields(car.suspension,['steer','wheels']),mechanics:car.suspension.mechanics?packFields(car.suspension.mechanics):undefined,
    timings:{...car.timings},contactProfile:{...car.contactProfile},work:[...car.panelWork].map(([p,v])=>[p.id,v] as const),cue:packPhysics(car.collisionCue)};
}
export type PhysicsCarSnapshot=ReturnType<typeof capturePhysicsCar>;
export function applyPhysicsCar(car:Vehicle3D,state:PhysicsCarSnapshot){
  applyFields(car,state.car);applyFields(car.body,state.body);car.clock.restore(state.tick,state.pending);
  const parts=car.root.world.parts;for(const p of parts.values())p.children.clear();
  for(const row of state.parts){const p=parts.get(row.id);if(!p)throw Error(`Physics part ${row.id} no longer exists`);p.parent=row.parent===undefined?undefined:parts.get(row.parent);p.parentSlot=row.parentSlot;p.ownSlot=row.ownSlot;p.condition=row.condition;applyFields(p,row.fields);if(p.parent)p.parent.children.set(p.parentSlot!,p);}
  for(const row of state.soft){const s=car.soft.get(parts.get(row.id)!)!;applyFields(s.panel,row.panel);s.panel.clock.restore(row.tick,row.pending);applyFields(s.activity,row.activity);
    s.panel.beams.forEach((b,i)=>{b.rest=row.beams[i*2];b.lambda=row.beams[i*2+1];});s.panel.mounts.forEach((m,i)=>{m.broken=!!row.mounts[i*3];m.force=row.mounts[i*3+1];m.overload=row.mounts[i*3+2];});
    if(row.free){if(!s.activity.freeBody)s.activity.makeRigid(s.part.matrix());applyFields(s.activity.freeBody!,row.free);}else s.activity.freeBody=undefined;
    applyFields(s.activity,row.activity);
  }
  for(const row of state.rigid){const r=car.rigid.get(parts.get(row.id)!)!;applyFields(r.body,row.body);r.previous.copy(unpackPhysics(row.previous));r.peakForce=row.peakForce;}
  applyFields(car.suspension,state.suspension);if(state.mechanics&&car.suspension.mechanics)applyFields(car.suspension.mechanics,state.mechanics);
  Object.assign(car.timings,state.timings);Object.assign(car.contactProfile,state.contactProfile);car.panelWork.clear();for(const [id,v]of state.work)car.panelWork.set(parts.get(id)!,v);car.collisionCue=unpackPhysics(state.cue);
  car.driving.position.setFromMatrixPosition(car.root.matrix());car.driving.speed=car.body.velocity.dot(new Vector3(0,0,-1).applyQuaternion(car.body.orientation));
}
export interface PhysicsVehicleSeed{
  root:number;hood:number;frequency:number;solver?:'ror'|'xpbd';bounds:number[][];samples:number[];
  parts:{id:number;definition:PartDefinition;parent?:number;parentSlot?:number;ownSlot?:number;fields:PhysicsFields}[];
  world:PhysicsFields;registrations:{id:number;samples:number[];triangles:number[]}[];triangles:number[];state:PhysicsCarSnapshot;
}
export function createPhysicsSeed(car:Vehicle3D):PhysicsVehicleSeed{
  const recipe=car.physicsRecipe();return {root:car.root.id,hood:car.hood.id,frequency:car.physicsFrequency,solver:car.panelSolver,bounds:[car.chassisBounds.min.toArray(),car.chassisBounds.max.toArray()],samples:recipe.samples,
    parts:recipe.tree.map(row=>({id:row.part.id,definition:row.part.definition,parent:row.parent?.id,parentSlot:row.parentSlot,ownSlot:row.ownSlot,fields:{...packFields(row.part,['wheelFrameOffsetY','wheelFrameOffsets','nativeId']),local:packPhysics(row.local),slotPositions:[...row.part.slotPositions],slotRotations:[...row.part.slotRotations]}})),
    world:packFields(car.root.world,['mechanical','javaPowertrain','wheelRefs','experimentalHubGeometry']),registrations:car.physicsRegistration.map(r=>({id:r.part.id,samples:r.samples,triangles:r.triangles})),triangles:recipe.triangles,state:capturePhysicsCar(car)};
}
export function buildPhysicsCar(seed:PhysicsVehicleSeed,terrain:Terrain&{ramp:boolean},collision?:MapCollision){
  const world=new EngineWorld();applyFields(world,seed.world);
  const byId=new Map<number,EnginePart>();for(const row of seed.parts){const p=new EnginePart(world,row.id,row.definition);world.parts.set(p.id,p);byId.set(row.id,p);const {slotPositions,slotRotations,...fields}=row.fields;applyFields(p,fields);for(const [id,v]of slotPositions)p.slotPositions.set(id,v);for(const [id,v]of slotRotations)p.slotRotations.set(id,v);}
  for(const row of seed.parts){const p=byId.get(row.id)!;p.parent=byId.get(row.parent!);p.parentSlot=row.parentSlot;p.ownSlot=row.ownSlot;if(p.parent)p.parent.children.set(p.parentSlot!,p);}
  const car=new Vehicle3D(byId.get(seed.root)!,byId.get(seed.hood)!,seed.samples,new Box3(new Vector3().fromArray(seed.bounds[0]),new Vector3().fromArray(seed.bounds[1])),terrain,collision,seed.frequency,seed.solver??'ror');
  for(const row of seed.registrations)car.register(byId.get(row.id)!,row.samples,row.triangles);car.setBodyTriangles(seed.triangles);applyPhysicsCar(car,seed.state);return car;
}
export interface PhysicsControl {id:number;version:number;input:DrivingInput;settings:PhysicsFields;conditions?:[number,number][];carSettings?:PhysicsFields;ramp?:boolean;commands:{method:string;args:any[]}[];bodyDelta:PhysicsFields;recording:boolean;recordingId?:number}

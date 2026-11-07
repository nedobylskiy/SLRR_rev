import {Matrix4,Quaternion,Vector3} from 'three';
import {EngineWorld,type PartDefinition,type JavaStockSelection} from './world';
import type {WheelRefState} from '../runtime/wheel-ref-native';
import type {DrivingInput} from './driving-demo';

export interface RoutePose {t:number;position:number[];rotation:number[];velocity:number[];angularVelocity:number[];
  rpm:number;gear:number;running:boolean;manual:boolean;temperature:number;steer:number;
  wheels:{omega:number;spin:number;length:number;slip:number;angle:number}[]}
export type RouteMode='render'|'physics'|'free-physics';
/** Tick-time checkpoints: render cadence cannot change when reference state is restored. */
export class RouteCheckpoints {
  private next=.1;
  count=0;maxCorrection=0;private squaredCorrection=0;
  apply(time:number,position:Vector3,playback:RoutePlayback,restore:(pose:RoutePose)=>void){
    if(time+1e-9<this.next)return;
    const pose=playback.pose(time),correction=position.distanceTo(new Vector3().fromArray(pose.position));
    this.count++;this.maxCorrection=Math.max(this.maxCorrection,correction);this.squaredCorrection+=correction*correction;
    restore(pose);this.next=(Math.floor((time+1e-9)*10)+1)/10;
  }
  get rmsCorrection(){return this.count?Math.sqrt(this.squaredCorrection/this.count):0;}
}
export interface RouteCamera {position:number[];rotation:number[];fov:number;near:number;far:number;unlimitedFar?:number}
export interface RouteView {t:number;primary:RouteCamera;observer?:RouteCamera;focus:number[]}
export interface RouteVehicle {
  root:number;mechanical:boolean;experimentalHubGeometry:boolean;bodyCenter:number[];mass:number;
  powertrain?:JavaStockSelection['powertrain'];wheelRefs:(WheelRefState|undefined)[];
  parts:{id:number;parent?:number;parentSlot?:number;ownSlot?:number;definition:PartDefinition;matrix:number[];
    renderAdjustment:number[];renderVisible:boolean;
    condition:number;paintTexture?:{pack:string;id:number};wheelFrameOffsetY:number;wheelFrameOffsets:number[][];
    slotPositions:[number,number[]][];slotRotations:[number,number[]][]}[];
}
export interface RouteBenchmark {format:'slrr-route-benchmark';version:1;metadata:Record<string,string|number>;
  vehicle:RouteVehicle;poses:RoutePose[];views:RouteView[];controls:{t:number;input:DrivingInput}[];
  sourceRender?:{frameIntervalsMs:number[];drawCallsSum:number;trianglesSum:number;width:number;height:number};
  limitations:string[]}

export function routeSourceSummary(route:RouteBenchmark){
  const source=route.sourceRender;if(!source?.frameIntervalsMs.length)return undefined;
  const sorted=[...source.frameIntervalsMs].sort((a,b)=>a-b),count=sorted.length,sum=sorted.reduce((a,b)=>a+b,0);
  return {frames:count,wall_s:sum/1000,mean_fps:count*1000/sum,p95_ms:sorted[Math.max(0,Math.ceil(count*.95)-1)],max_ms:sorted.at(-1)!,
    average_draws:source.drawCallsSum/count,average_triangles:source.trianglesSum/count,width:source.width,height:source.height};
}

export function restoreRouteVehicle(snapshot:RouteVehicle){
  const world=new EngineWorld(),parts=new Map<number,ReturnType<EngineWorld['create']>>();
  world.mechanical=snapshot.mechanical;world.experimentalHubGeometry=snapshot.experimentalHubGeometry;
  world.javaPowertrain=structuredClone(snapshot.powertrain);world.wheelRefs=structuredClone(snapshot.wheelRefs).map(w=>w??undefined);
  try {
    for(const saved of snapshot.parts){
      const part=world.create(structuredClone(saved.definition));parts.set(saved.id,part);
      part.condition=saved.condition;part.paintTexture=saved.paintTexture;
      part.renderAdjustment.fromArray(saved.renderAdjustment);part.renderVisible=saved.renderVisible;
      part.wheelFrameOffsetY=saved.wheelFrameOffsetY;part.wheelFrameOffsets=saved.wheelFrameOffsets.map(v=>[...v] as [number,number,number]);
      for(const [id,p] of saved.slotPositions)part.slotPositions.set(id,[...p] as [number,number,number]);
      for(const [id,p] of saved.slotRotations)part.slotRotations.set(id,[...p] as [number,number,number]);
    }
    for(const saved of snapshot.parts)if(saved.parent!==undefined)world.install(parts.get(saved.parent)!,saved.parentSlot!,parts.get(saved.id)!,saved.ownSlot!);
    for(const saved of snapshot.parts)parts.get(saved.id)!.local.fromArray(saved.matrix);
    return {world,root:parts.get(snapshot.root)!};
  }catch(error){world.dispose();throw error;}
}

export function parseRouteBenchmark(text:string):RouteBenchmark {
  if(text.length>100*1024*1024)throw Error('Route exceeds 100 MiB');
  const route=JSON.parse(text) as RouteBenchmark;
  if(route?.format!=='slrr-route-benchmark'||route.version!==1||!route.metadata||typeof route.metadata.map_pack!=='string'
    ||!Array.isArray(route.poses)||route.poses.length<2||route.poses.length>18001||!Array.isArray(route.views)||!route.views.length||route.views.length>36001
    ||!Array.isArray(route.controls)||route.controls.length>432001||!route.vehicle?.parts?.length||route.vehicle.parts.length>1000)
    throw Error('Invalid route benchmark; use Download route benchmark after recording a drive');
  const vec=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
  const source=route.sourceRender;
  if(source&&(!Array.isArray(source.frameIntervalsMs)||source.frameIntervalsMs.length>432000||!source.frameIntervalsMs.every(v=>Number.isFinite(v)&&v>0)
    ||![source.drawCallsSum,source.trianglesSum,source.width,source.height].every(v=>Number.isFinite(v)&&v>=0)))throw Error('Invalid source render measurements');
  const quat=(v:number[])=>vec(v,4)&&Math.abs(Math.hypot(...v)-1)<.01;
  const timed=(rows:{t:number}[])=>rows.every((p,i)=>Number.isFinite(p.t)&&p.t>=0&&p.t<=1801&&(!i||p.t>rows[i-1].t));
  const camera=(c:RouteCamera)=>c&&vec(c.position,3)&&quat(c.rotation)&&Number.isFinite(c.fov)&&c.fov>1&&c.fov<179
    &&Number.isFinite(c.near)&&c.near>0&&Number.isFinite(c.far)&&c.far>c.near&&(c.unlimitedFar===undefined||Number.isFinite(c.unlimitedFar)&&c.unlimitedFar>c.near);
  if(!vec(route.vehicle.bodyCenter,3)||!Number.isFinite(route.vehicle.mass)||route.vehicle.mass<=0||!timed(route.poses)||!timed(route.views)||!timed(route.controls)||route.poses.some(p=>!vec(p.position,3)||!quat(p.rotation)
    ||!vec(p.velocity,3)||!vec(p.angularVelocity,3)||![p.rpm,p.temperature,p.steer].every(Number.isFinite)||typeof p.running!=='boolean'||typeof p.manual!=='boolean'||!Number.isInteger(p.gear)||!Array.isArray(p.wheels)||p.wheels.length!==4
    ||!p.wheels.every(w=>[w.omega,w.spin,w.length,w.slip,w.angle].every(Number.isFinite)))
    ||route.views.some(v=>!camera(v.primary)||v.observer&&!camera(v.observer)||!vec(v.focus,3))
    ||route.controls.some(c=>!c.input||![c.input.throttle,c.input.steer].every(v=>Number.isFinite(v)&&Math.abs(v)<=1)
      ||typeof c.input.brake!=='boolean'||(['clutch','gearUp','gearDown','neutral','start'] as const).some(k=>c.input[k]!==undefined&&typeof c.input[k]!=='boolean')
      ||c.input.throttleMode!==undefined&&!['directional','pedal'].includes(c.input.throttleMode)))throw Error('Invalid route poses, cameras or controls');
  const ids=new Set<number>();
  for(const p of route.vehicle.parts){
    if(!Number.isSafeInteger(p.id)||ids.has(p.id)||!p.definition?.config?.slots||!p.definition.key?.pack||!vec(p.matrix,16)||!vec(p.renderAdjustment,16)||typeof p.renderVisible!=='boolean'
      ||!Number.isFinite(p.condition)||p.condition<0||p.condition>1)throw Error('Invalid vehicle snapshot');ids.add(p.id);
  }
  if(!ids.has(route.vehicle.root)||route.vehicle.parts.some(p=>p.parent!==undefined&&!ids.has(p.parent)))throw Error('Missing snapshot root or parent');
  for(const p of route.vehicle.parts){
    const seen=new Set<number>();let node:typeof p|undefined=p;
    while(node){if(seen.has(node.id))throw Error('Cyclic vehicle snapshot');seen.add(node.id);node=route.vehicle.parts.find(v=>v.id===node!.parent);}
    if(!Number.isFinite(p.wheelFrameOffsetY)||!Array.isArray(p.wheelFrameOffsets)||!p.wheelFrameOffsets.every(v=>vec(v,3))
      ||![p.slotPositions,p.slotRotations].every(rows=>Array.isArray(rows)&&rows.every(r=>Array.isArray(r)&&Number.isInteger(r[0])&&vec(r[1],3))))throw Error('Invalid mount snapshot');
  }
  return route;
}

function interval<T extends {t:number}>(rows:T[],time:number):[T,T,number]{
  let low=0,high=rows.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(rows[mid].t<=time)low=mid;else high=mid-1;}
  const a=rows[low],b=rows[Math.min(low+1,rows.length-1)];
  return [a,b,b.t>a.t?Math.max(0,Math.min(1,(time-a.t)/(b.t-a.t))):0];
}
const lerp=(a:number[],b:number[],t:number)=>a.map((v,i)=>v+(b[i]-v)*t);
const rotation=(a:number[],b:number[],t:number)=>new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b),t).toArray();
export class RoutePlayback {
  readonly duration:number;
  constructor(readonly route:RouteBenchmark){this.duration=route.poses.at(-1)!.t;}
  pose(time:number):RoutePose{
    const [a,b,t]=interval(this.route.poses,time);
    return {...a,t:time,position:lerp(a.position,b.position,t),rotation:rotation(a.rotation,b.rotation,t),velocity:lerp(a.velocity,b.velocity,t),angularVelocity:lerp(a.angularVelocity,b.angularVelocity,t),
      rpm:a.rpm+(b.rpm-a.rpm)*t,steer:a.steer+(b.steer-a.steer)*t,wheels:a.wheels.map((w,i)=>({...w,
        omega:w.omega+(b.wheels[i].omega-w.omega)*t,spin:w.spin+(b.wheels[i].spin-w.spin)*t,length:w.length+(b.wheels[i].length-w.length)*t}))};
  }
  view(time:number):RouteView{
    const [a,b,t]=interval(this.route.views,time);
    const camera=(x:RouteCamera,y:RouteCamera):RouteCamera=>({...x,position:lerp(x.position,y.position,t),rotation:rotation(x.rotation,y.rotation,t)});
    return {...a,t:time,primary:camera(a.primary,b.primary),observer:a.observer?camera(a.observer,b.observer??a.observer):undefined,focus:lerp(a.focus,b.focus,t)};
  }
  input(time:number):DrivingInput{return this.route.controls.length?interval(this.route.controls,time+1e-9)[0].input:{throttle:0,steer:0,brake:false};}
}

export function routeBodyMatrix(pose:RoutePose,center:Vector3){return new Matrix4().compose(new Vector3().fromArray(pose.position),new Quaternion().fromArray(pose.rotation),new Vector3(1,1,1)).multiply(new Matrix4().makeTranslation(-center.x,-center.y,-center.z));}

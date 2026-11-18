import {jv,type SlrrJvm,type JavaValue} from 'slrr-jvm';
import type {RoadNetwork,RoadPoint} from '../formats/trc';
import {nearestRoadCrossing} from '../engine/road-nearest';
import {roadRoutes} from '../engine/road-route';
import type {TrafficHalts} from '../engine/traffic-models';
interface HaltState {revision:number;roads:Set<number>;crossings:Map<number,number>;cached?:TrafficHalts}

/** Loads the receiver's own map graph through the shared asset cache; returns an independently mutable Java vector. */
export class GroundRoadNative {
  /** Original plotRoute has no endpoints: it consumes the last ground route query. */
  private plottedRoute?:RoadPoint[];
  routeForPlot(){return this.plottedRoute?.map(p=>[...p] as RoadPoint);}
  private halts=new WeakMap<object,HaltState>();
  private empty:TrafficHalts={revision:0,roads:[],crossings:[]};
  trafficHalts(receiver:JavaValue):TrafficHalts {
    const key=this.key(receiver),state=key&&this.halts.get(key);if(!state)return this.empty;
    const now=performance.now();for(const [id,expires]of state.crossings)if(now>=expires){state.crossings.delete(id);state.revision++;}
    if(state.cached?.revision!==state.revision)state.cached={revision:state.revision,roads:[...state.roads],crossings:[...state.crossings.keys()]};return state.cached;
  }
  private key:(receiver:JavaValue)=>object|undefined;
  constructor(jvm:SlrrJvm,networkFor:(receiver:JavaValue)=>Promise<RoadNetwork|undefined>,key?:(receiver:JavaValue)=>object|undefined){
    this.key=key??(receiver=>receiver.value&&typeof receiver.value==='object'?receiver.value as object:undefined);
    const point=(value:JavaValue):RoadPoint|undefined=>{if(value.value==null)return;const p=['x','y','z'].map(axis=>Number(jvm.get(value,axis).value)) as RoadPoint;return p.every(Number.isFinite)?p:undefined;};
    const vector=(p:RoadPoint)=>jv('Vector3',{className:'java.lang.Vector3',fields:new Map(['x','y','z'].map((axis,i)=>[axis,jv('float',Math.fround(p[i]))]))});
    const stateFor=(receiver:JavaValue)=>{const key=this.key(receiver);if(!key)return;let state=this.halts.get(key);if(!state){state={revision:0,roads:new Set(),crossings:new Map()};this.halts.set(key,state);}return state;};
    jvm.natives.registerAsync('java.util.resource.GroundRef','alignToRoad',['Vector3'],async({receiver,args})=>{
      const p=point(args[0]),network=receiver.value!=null&&p?await networkFor(receiver):undefined;
      const aligned=network&&p?roadRoutes(network).align(p):undefined;
      // City uses [0] for placement and [1] for the road's direction. Both are
      // independent mutable Java vectors; this query must not replace plotRoute.
      return jv('Vector3[]',aligned?[vector(aligned.position).value,vector(aligned.direction).value]:null);
    });
    for(const method of ['getRouteLength','getStartDirection','haltTrafficPath'])jvm.natives.registerAsync('java.util.resource.GroundRef',method,['Vector3','Vector3'],async({receiver,args})=>{
      const a=point(args[0]),b=point(args[1]),network=receiver.value!=null&&a&&b?await networkFor(receiver):undefined;
      const graph=network&&roadRoutes(network),route=graph&&a&&b?graph.query(a,b):undefined;
      if(method!=='haltTrafficPath')this.plottedRoute=route?.points;
      if(method==='getRouteLength')return jv('float',route?Math.fround(route.length):-1);
      if(method==='getStartDirection')return route&&route.direction.some(v=>Math.abs(v)>1e-8)?vector(route.direction):jv('Vector3',null);
      if(route&&graph){const state=stateFor(receiver);if(state){for(const road of graph.haltRoads(route))state.roads.add(road);state.revision++;}}
      return jv('void',undefined);
    });
    for(const type of ['int','float'])jvm.natives.registerAsync('java.util.resource.GroundRef','haltTrafficCross',['Vector3',type],async({receiver,args})=>{
      const p=point(args[0]),seconds=Number(args[1].value);if(!p||!Number.isFinite(seconds)||seconds<=0||receiver.value==null)return jv('void',undefined);
      const network=await networkFor(receiver),node=network&&nearestRoadCrossing(network,p),state=node&&stateFor(receiver);
      if(state&&node){state.crossings.set(node.id,Math.max(state.crossings.get(node.id)??0,performance.now()+seconds*1000));state.revision++;}return jv('void',undefined);
    });
    jvm.natives.register('java.util.resource.GroundRef','clearHalts',[],({receiver})=>{const state=stateFor(receiver);if(state){state.roads.clear();state.crossings.clear();state.revision++;}return jv('void',undefined);});
    for(const distanceType of ['int','float'])jvm.natives.registerAsync('java.util.resource.GroundRef','getNearestCross',['Vector3',distanceType],async({receiver,args})=>{
      if(receiver.value==null||args[0].value==null)return jv('Vector3',null);
      const point=['x','y','z'].map(axis=>Number(jvm.get(args[0],axis).value)) as RoadPoint,radius=Number(args[1].value);
      if(!point.every(Number.isFinite)||!Number.isFinite(radius))return jv('Vector3',null);
      const network=await networkFor(receiver),node=network&&nearestRoadCrossing(network,point,radius);
      if(!node)return jv('Vector3',null);
      return jv('Vector3',{className:'java.lang.Vector3',fields:new Map(['x','y','z'].map((axis,i)=>[axis,jv('float',node.position[i])]))});
    });
  }
}

import {jv,type SlrrJvm,type JavaValue} from 'slrr-jvm';
import type {RoadNetwork,RoadPoint} from '../formats/trc';
import {nearestRoadCrossing} from '../engine/road-nearest';

/** Loads the receiver's own map graph through the shared asset cache; returns an independently mutable Java vector. */
export class GroundRoadNative {
  constructor(jvm:SlrrJvm,networkFor:(receiver:JavaValue)=>Promise<RoadNetwork|undefined>){
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

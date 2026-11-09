import { Group, Matrix4, Sprite, Vector3 } from 'three';
import type { Assets } from '../assets';
import { vehicleLight, type VehicleLight } from '../engine/vehicle-light';
import { poseMatrix, type EngineWorld } from '../engine/world';
import { createVehicleFlare } from './vehicle-flare';
import { cfgRenderVisible } from './vehicle-lights';

export interface TrafficLamp { source:VehicleLight; matrix:Matrix4; flags:number }
export const TRAFFIC_INDICATOR_ANGLE=5*Math.PI/180;

/** Positive wheel yaw turns left in the vehicle's -Z forward frame. Blink independently of day/night. */
export function trafficIndicatorMask(steerRadians:number,forwardSpeed:number,seconds:number):number {
  if(forwardSpeed<=.05||Math.abs(steerRadians)<=TRAFFIC_INDICATOR_ANGLE||seconds%1>=.5)return 0;
  return steerRadians>0?16:32;
}

/** Start with a visible flash and retain short steering pulses long enough to be seen. */
export class TrafficIndicators {
  private side=0;
  private started=0;
  private until=0;
  update(angle:number,speed:number,seconds:number){
    if(speed<=.05){this.side=0;return 0;}
    const selected=trafficIndicatorMask(angle,speed,0);
    if(selected){if(selected!==this.side)this.started=seconds;this.side=selected;this.until=seconds+.8;}
    if(seconds>=this.until){this.side=0;return 0;}
    return (seconds-this.started)%1<.5?this.side:0;
  }
}

/** Some stock traffic CFGs (including Pickup) author only front indicators. Reuse rear lens anchors. */
export function completeTrafficIndicators(lamps:readonly TrafficLamp[]):TrafficLamp[]{
  const result=[...lamps],position=(lamp:TrafficLamp)=>new Vector3(...lamp.source.position).applyMatrix4(lamp.matrix);
  for(const side of [16,32]){
    if(lamps.some(lamp=>(lamp.flags&side)!==0&&position(lamp).z>0))continue;
    const rear=lamps.find(lamp=>(lamp.flags&2)!==0&&position(lamp).z>0&&(position(lamp).x<0?16:32)===side)
      ??lamps.find(lamp=>(lamp.flags&4)!==0&&position(lamp).z>0&&(position(lamp).x<0?16:32)===side);
    if(rear)result.push({matrix:rear.matrix.clone(),flags:side,source:{...rear.source,color:[1,.6,0],beam:undefined}});
  }
  return result;
}

/** Traffic CFG lamps carry LOD tags; read light resources without selecting another body LOD. */
export async function trafficLampDefinitions(world:EngineWorld,assets:Assets):Promise<TrafficLamp[]> {
  const lamps:TrafficLamp[]=[];
  for(const part of world.parts.values())for(const render of part.definition.config.renders){
    if(!((render.flags??0)&0x37))continue;
    const source=await vehicleLight(assets,part.definition.key.pack,render.resource);
    if(!source)continue;
    const matrix=part.matrix().clone();if(render.pose)matrix.multiply(poseMatrix(render.pose));
    lamps.push({source,matrix,flags:render.flags??0});
  }
  return completeTrafficIndicators(lamps);
}

/** Only depth-tested sprites: no SpotLight, shadow map, projector, or gobo. */
export async function createTrafficLamps(definitions:readonly TrafficLamp[],assets:Assets){
  const group=new Group();group.name='Traffic lamp flares';group.userData.trafficEffect=true;
  const indicators=new TrafficIndicators();
  const dispose=()=>group.traverse(object=>{if(object instanceof Sprite){object.material.map?.dispose();object.material.dispose();}});
  try{
    for(const definition of definitions){
      const lamp=new Group();lamp.matrixAutoUpdate=false;lamp.matrix.copy(definition.matrix);lamp.userData.lightFlags=definition.flags;
      group.add(lamp);lamp.add(await createVehicleFlare(definition.source,assets,.08,definition.flags));
    }
  }catch(error){dispose();throw error;}
  return {group,update:(mask:number,angle=0,speed=0,seconds=0)=>{mask=(mask&~48)|indicators.update(angle,speed,seconds);for(const lamp of group.children)lamp.visible=cfgRenderVisible(lamp.userData.lightFlags,mask);},dispose};
}

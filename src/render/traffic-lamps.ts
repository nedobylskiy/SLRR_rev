import { Group, Matrix4, Sprite } from 'three';
import type { Assets } from '../assets';
import { vehicleLight, type VehicleLight } from '../engine/vehicle-light';
import { poseMatrix, type EngineWorld } from '../engine/world';
import { createVehicleFlare } from './vehicle-flare';
import { cfgRenderVisible } from './vehicle-lights';

export interface TrafficLamp { source:VehicleLight; matrix:Matrix4; flags:number }

/** Traffic CFG lamps carry LOD tags; read light resources without selecting another body LOD. */
export async function trafficLampDefinitions(world:EngineWorld,assets:Assets):Promise<TrafficLamp[]> {
  const lamps:TrafficLamp[]=[];
  for(const part of world.parts.values())for(const render of part.definition.config.renders){
    if(!((render.flags??0)&7))continue;
    const source=await vehicleLight(assets,part.definition.key.pack,render.resource);
    if(!source)continue;
    const matrix=part.matrix().clone();if(render.pose)matrix.multiply(poseMatrix(render.pose));
    lamps.push({source,matrix,flags:render.flags??0});
  }
  return lamps;
}

/** Only depth-tested sprites: no SpotLight, shadow map, projector, or gobo. */
export async function createTrafficLamps(definitions:readonly TrafficLamp[],assets:Assets){
  const group=new Group();group.name='Traffic lamp flares';group.userData.trafficEffect=true;
  const dispose=()=>group.traverse(object=>{if(object instanceof Sprite){object.material.map?.dispose();object.material.dispose();}});
  try{
    for(const definition of definitions){
      const lamp=new Group();lamp.matrixAutoUpdate=false;lamp.matrix.copy(definition.matrix);lamp.userData.lightFlags=definition.flags;
      group.add(lamp);lamp.add(await createVehicleFlare(definition.source,assets,.08,definition.flags));
    }
  }catch(error){dispose();throw error;}
  return {group,update:(mask:number)=>{for(const lamp of group.children)lamp.visible=cfgRenderVisible(lamp.userData.lightFlags,mask);},dispose};
}

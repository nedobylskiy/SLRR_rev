import {jv,type JavaValue,type SlrrJvm} from 'slrr-jvm';
import type {RoadNetwork} from '../formats/trc';
import {roadSpeedZones} from '../engine/road-speed-zones';
import {GameObject} from './game-object';
import type {ResourceObject} from './resource-object';
import type {GameTypeNative} from './game-type-native';

export class VehicleCrimeNative {
  constructor(jvm:SlrrJvm,types:GameTypeNative,networkFor:(map:JavaValue)=>Promise<RoadNetwork|undefined>){
    // Original 0x440bf0 reads active speed-zone limit (m/s), not a crime boolean.
    // Host road groups supply the zone; City itself adds the 10% tolerance.
    jvm.natives.registerAsync('java.game.Vehicle','hasCrime',[],async({receiver})=>{
      const car=receiver.value!=null?types.get(receiver):undefined;if(!car)return jv('float',-1);
      let map:ResourceObject|null=car;
      while(map&&!(map instanceof GameObject&&map.worldTreeRoot))map=map.parent;
      const network=map?await networkFor(types.reference(map)):undefined;
      return jv('float',network&&!car.destroyed?roadSpeedZones(network).limit(car.position):-1);
    });
  }
}

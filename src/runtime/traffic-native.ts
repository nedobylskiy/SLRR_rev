import {jv,type SlrrJvm,type JavaValue,type ResourceIdentity} from 'slrr-jvm';
import {normalizeResourcePackPath} from '../assets';
import type {TrafficModel} from '../engine/traffic-models';

/** Per-ground original Java traffic declarations. Population/physics is hosted by the stream renderer. */
export class TrafficNative {
  private catalogs=new WeakMap<object,readonly TrafficModel[]>();
  constructor(jvm:SlrrJvm,private ground:(receiver:JavaValue)=>object|undefined,resolve:(value:JavaValue)=>ResourceIdentity|undefined){
    for(const countType of ['int','float'])jvm.natives.register('java.util.resource.GroundRef','addTrafficN',['GameRef',countType,'float','float','float'],({receiver,args})=>{
      const ground=this.ground(receiver),key=resolve(args[0]),weight=Number(args[1].value);
      if(!ground||!key||!Number.isFinite(weight)||weight<0)return jv('int',0);
      if(weight===0){if(!this.catalogs.has(ground))this.catalogs.set(ground,[]);return jv('int',0);}
      const model:TrafficModel={pack:normalizeResourcePackPath(key.pack),id:key.id&0xffff,weight,parameters:args.slice(2).map(arg=>Number(arg.value))};
      const models=[...(this.catalogs.get(ground)??[])],index=models.findIndex(entry=>entry.pack===model.pack&&entry.id===model.id);
      if(index<0)models.push(model);else models[index]={...model,weight:models[index].weight+weight};
      this.catalogs.set(ground,models);return jv('int',index<0?models.length:index+1);
    });
    jvm.natives.register('java.util.resource.GroundRef','delTraffic',[],({receiver})=>{const ground=this.ground(receiver);if(ground)this.catalogs.set(ground,[]);return jv('void',undefined);});
  }
  models(receiver:JavaValue):readonly TrafficModel[]|undefined {const ground=this.ground(receiver);return ground?this.catalogs.get(ground):undefined;}
}

import {jv,type SlrrJvm,type JavaValue,type ResourceIdentity} from 'slrr-jvm';
import {normalizeResourcePackPath} from '../assets';
import type {TrafficModel,TrafficPose,TrafficStreamHandle,JavaTrafficBridge} from '../engine/traffic-models';
import type {GameTypeNative} from './game-type-native';
import type {JavaStockSelection} from '../engine/world';
import {Vector3} from 'three';
import type {RoadNetwork} from '../formats/trc';
import {TrafficSpawnIndex} from '../engine/traffic-stream';
import {DistantRivals,DISTANT_RIVAL_INTERVAL} from '../engine/distant-rivals';
interface Registration {id:number;ground:object;map:JavaValue;car:JavaValue;model:TrafficModel;individual:boolean;visible:boolean;notify:boolean;valid:boolean;state?:JavaValue;}

/** Per-ground original Java traffic declarations. Population/physics is hosted by the stream renderer. */
export class TrafficNative {
  private catalogs=new WeakMap<object,readonly TrafficModel[]>();
  private registrations=new Map<number,Registration>();private byCar=new WeakMap<object,Registration>();private nextId=1;
  private distant=new WeakMap<object,{next:number;planner?:DistantRivals;pending?:Promise<void>}>();
  private bridges=new WeakMap<object,{state:JavaValue;bridge:JavaTrafficBridge}>();
  constructor(private jvm:SlrrJvm,private ground:(receiver:JavaValue)=>object|undefined,private resolve:(value:JavaValue)=>ResourceIdentity|undefined,private gameTypes?:GameTypeNative,private networkFor?:(map:JavaValue)=>Promise<RoadNetwork|undefined>){
    for(const countType of ['int','float'])jvm.natives.register('java.util.resource.GroundRef','addTrafficN',['GameRef',countType,'float','float','float'],({receiver,args})=>{
      const ground=this.ground(receiver),key=this.resolve(args[0]),weight=Number(args[1].value);
      if(!ground||!key||!Number.isFinite(weight)||weight<0)return jv('int',0);
      if(weight===0){if(!this.catalogs.has(ground))this.catalogs.set(ground,[]);return jv('int',0);}
      const model:TrafficModel={pack:normalizeResourcePackPath(key.pack),id:key.id&0xffff,weight,parameters:args.slice(2).map(arg=>Number(arg.value)),...(this.gameTypes?{javaTypeId:this.gameTypes.getResource(args[0])?.typeId}:{})};
      const models=[...(this.catalogs.get(ground)??[])],index=models.findIndex(entry=>entry.pack===model.pack&&entry.id===model.id);
      if(index<0)models.push(model);else models[index]={...model,weight:models[index].weight+weight};
      this.catalogs.set(ground,models);return jv('int',index<0?models.length:index+1);
    });
    jvm.natives.register('java.util.resource.GroundRef','delTraffic',[],({receiver})=>{const ground=this.ground(receiver);if(ground){for(const entry of [...this.registrations.values()])if(entry.ground===ground)this.remove(entry,true);this.catalogs.set(ground,[]);}return jv('void',undefined);});
    if(this.gameTypes){
      jvm.natives.register('java.util.resource.GroundRef','addTrafficCar',['GameRef','Vector3'],({receiver,args})=>{
        const ground=this.ground(receiver),node=this.gameTypes!.get(args[0]),identity=this.resolve(args[0]);
        if(!ground||!node||!identity)return jv('int',0);
        const existing=[...this.registrations.values()].find(r=>r.valid&&r.ground===ground&&this.gameTypes!.getResource(r.car)===node);if(existing)return jv('int',existing.id);
        if(args[1].value!=null){const coords=['x','y','z'].map(axis=>Number(this.jvm.get(args[1],axis).value));if(coords.every(Number.isFinite))Object.assign(node.position,{x:coords[0],y:coords[1],z:coords[2]});}
        const id=this.nextId++,model:TrafficModel={pack:normalizeResourcePackPath(identity.pack),id:identity.id&0xffff,weight:1,registrationId:id,javaTypeId:node.typeId};
        const record:Registration={id,ground,map:receiver,car:this.gameTypes!.reference(node),model,individual:true,visible:false,notify:false,valid:true};this.registrations.set(id,record);this.byCar.set(node,record);
        this.catalogs.set(ground,[...(this.catalogs.get(ground)??[]),model]);return jv('int',id);
      });
      jvm.natives.register('java.util.resource.GroundRef','notifyTrafficCar',['int','int'],({receiver,args})=>{
        const entry=this.registrations.get(Number(args[0].value));if(!entry||entry.ground!==this.ground(receiver))return jv('int',0);
        const enabled=!!args[1].value;if(entry.visible&&entry.notify!==enabled)this.event(entry,enabled?'car_add':'car_rem');entry.notify=enabled;return jv('int',1);
      });
      jvm.natives.register('java.util.resource.GroundRef','remTrafficCar',['int'],({receiver,args})=>{
        const entry=this.registrations.get(Number(args[0].value));if(entry&&entry.ground===this.ground(receiver))this.remove(entry,true);return jv('void',undefined);
      });
      this.gameTypes.setTrafficInfoReader((receiver,query)=>{
        const node=this.gameTypes!.getResource(receiver),entry=node&&this.byCar.get(node);
        if(!entry?.valid)return;
        if(query===56)return jv('int',entry.id);
        if(query===6)return {...jv('int',entry.model.javaTypeId??node!.typeId),resource:{pack:entry.model.pack,id:entry.model.id}};
        if(query===7)return jv('int',5);
      });
      this.gameTypes.addResourceDestroyListener(receiver=>{const node=this.gameTypes!.getResource(receiver);for(const r of [...this.registrations.values()])if(this.gameTypes!.getResource(r.car)===node||r.ground===node)this.remove(r,true);});
    }
  }
  private event(entry:Registration,command:'car_add'|'car_rem'){
    const target=entry.state??this.bridges.get(entry.ground)?.state,node=this.gameTypes?.getResource(entry.car);
    if(!target||!node||!this.gameTypes?.get(target))return;
    this.gameTypes.queueStringEvent(target,entry.map,16,jv('String',`${command} ${node.resourceId}${command==='car_add'?` ${entry.id}`:''}`));
  }
  private remove(entry:Registration,permanent:boolean){
    if(!entry.valid)return;
    if(entry.visible&&(!entry.individual||entry.notify))this.event(entry,'car_rem');entry.visible=false;
    if(permanent||!entry.individual){entry.valid=false;this.registrations.delete(entry.id);if(entry.individual)this.catalogs.set(entry.ground,(this.catalogs.get(entry.ground)??[]).filter(m=>m.registrationId!==entry.id));}
    if(!entry.individual){const node=this.gameTypes?.getResource(entry.car);if(node?.resourceType)this.jvm.natives.invoke('java.util.resource.ResourceRef','destroy',entry.car,[]);}
  }
  registeredCar(id:number):JavaValue|undefined {return this.registrations.get(id)?.car;}
  bridge(map:JavaValue,state:JavaValue,selection:(car:JavaValue,pack:string)=>Promise<JavaStockSelection|undefined>):JavaTrafficBridge {
    const ground=this.ground(map);if(!ground||!this.gameTypes)throw Error('Traffic bridge requires a live Java ground');
    const old=this.bridges.get(ground);if(old&&old.state.value===state.value)return old.bridge;
    const bridge:JavaTrafficBridge={
      location:model=>{const entry=model.registrationId?this.registrations.get(model.registrationId):undefined,node=entry&&this.gameTypes!.get(entry.car);return entry?.valid&&node?{position:{...node.position},yaw:node.orientation.y,velocity:{...node.velocity}}:undefined;},
      available:model=>this.ground(map)===ground&&(model.registrationId?!!this.registrations.get(model.registrationId)?.valid:!!this.catalogs.get(ground)?.some(m=>!m.registrationId&&m.pack===model.pack&&m.id===model.id)),
      selection:async model=>{const entry=model.registrationId?this.registrations.get(model.registrationId):undefined;return entry?.valid?selection(entry.car,model.pack):undefined;},
      spawn:(model,pose)=>{
        if(!bridge.available(model))return;
        let entry=model.registrationId?this.registrations.get(model.registrationId):undefined;
        if(model.registrationId&&!entry?.valid)return;
        if(!entry){const id=this.nextId++,car=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
          this.jvm.natives.invoke('java.lang.GameType','createNativeInstance',car,[jv('GameRef',map.value),jv('int',model.javaTypeId??this.gameTypes!.remountSavedResource(model.pack,model.id).value),jv('String',null),jv('String','streamed traffic')]);
          const node=this.gameTypes!.getResource(car)!;node.resourcePack=model.pack;
          entry={id,car,ground,map,model,individual:false,visible:false,notify:true,valid:true};this.registrations.set(id,entry);this.byCar.set(node,entry);
        }
        if(entry.visible)return;
        const record=entry;record.state=state;
        const sync=(pose:TrafficPose)=>{const node=this.gameTypes!.get(record.car);if(!record.valid||!node)return;Object.assign(node.position,pose.position);node.orientation.y=pose.yaw;Object.assign(node.velocity,pose.velocity);};
        sync(pose);record.visible=true;if(record.notify||!record.individual)this.event(record,'car_add');
        return {id:record.id,sync,remove:()=>this.remove(record,false),active:()=>record.valid&&!!this.gameTypes!.get(record.car)};
      },
    };
    this.bridges.set(ground,{state,bridge});return bridge;
  }
  async advanceDistant(map:JavaValue,focus:{x:number;y:number;z:number},near:number,now=performance.now()):Promise<void>{
    const ground=this.ground(map);if(!ground||!this.gameTypes||!this.networkFor)return;
    let state=this.distant.get(ground);if(!state){state={next:now};this.distant.set(ground,state);}
    if(state.pending||now<state.next)return;state.next=now+DISTANT_RIVAL_INTERVAL;
    const current=state,center=new Vector3(focus.x,focus.y,focus.z);
    const pending=(async()=>{
      if(!current.planner){const graph=await this.networkFor!(map);if(!graph)return;current.planner=new DistantRivals(new TrafficSpawnIndex(graph));}
      if(this.ground(map)!==ground)return;
      let registered=false;
      for(const entry of this.registrations.values())if(entry.valid&&entry.individual&&entry.ground===ground){
        registered=true;const node=this.gameTypes!.get(entry.car);if(!node)continue;
        const pose:TrafficPose={position:{...node.position},yaw:node.orientation.y,velocity:{...node.velocity}};
        if(current.planner.update(entry.id,pose,entry.visible,center,near,now)){Object.assign(node.position,pose.position);node.orientation.y=pose.yaw;Object.assign(node.velocity,pose.velocity);}
      }
      if(registered)this.catalogs.set(ground,[...(this.catalogs.get(ground)??[])]);
    })();current.pending=pending;try{await pending;}finally{if(current.pending===pending)current.pending=undefined;}
  }
  models(receiver:JavaValue):readonly TrafficModel[]|undefined {const ground=this.ground(receiver);return ground?this.catalogs.get(ground):undefined;}
  dispose():void {for(const entry of this.registrations.values())entry.valid=false;this.registrations.clear();this.catalogs=new WeakMap();this.bridges=new WeakMap();this.byCar=new WeakMap();this.distant=new WeakMap();}
}

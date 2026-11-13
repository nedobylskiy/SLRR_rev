import {test} from 'node:test';import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {TrafficNative} from '../src/runtime/traffic-native';
import {MAX_TRAFFIC_CARS,pickTrafficModel} from '../src/engine/traffic-models';
import {GameTypeNative} from '../src/runtime/game-type-native';

test('streamed cars report stable Java IDs, poses, type and balanced appearance notifications',async()=>{
 const source='package demo; class Listener { int calls; String last; void handleEvent(Object source,int event,String text){calls++;last=text;} }';
 const jvm=new SlrrJvm({resolveImport:()=>({path:'Listener.java',source})});await jvm.loadClass('demo.Listener');
 const types=new GameTypeNative(jvm,()=>{}),listener=await jvm.constructAsync('demo.Listener',[]);
 const object=(name:string)=>jv(name,{className:name,fields:new Map()});
 const map=object('GameRef'),other=object('GameRef'),police=object('GameRef');
 const create=(ref:typeof map,id=0)=>jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[jv('GameRef',null),jv('int',id),jv('String',null),jv('String',null)]);
 create(map);create(other);create(listener);
 jvm.natives.invoke('java.lang.GameType','setEventMask',listener,[jv('int',16)]);
 jvm.natives.invoke('java.util.resource.ResourceRef','set',police,[types.remountSavedResource('cars/misc/police.rpk',6)]);
 const traffic=new TrafficNative(jvm,ref=>types.getResource(ref),ref=>{const node=types.getResource(ref);return node?.resourcePack?{pack:node.resourcePack,id:node.typeId&0xffff}:undefined;},types);
 const call=(method:string,ref:typeof map,args:ReturnType<typeof jv>[])=>jvm.natives.invoke('java.util.resource.GroundRef',method,ref,args)!;
 const info=(ref:typeof map,query:number)=>jvm.natives.invokeAsync('java.util.resource.GameRef','getInfo',ref,[jv('int',query),jv('int',0)]);
 const bridge=traffic.bridge(map,listener,async()=>undefined),pose={position:{x:10,y:2,z:20},yaw:.5,velocity:{x:3,y:0,z:4}};
 call('addTrafficN',map,[police,jv('int',30),jv('float',2),jv('float',5),jv('float',2)]);
 const model=traffic.models(map)![0],handle=bridge.spawn(model,pose)!;
 types.dispatchQueuedEvents();const added=String(jvm.get(listener,'last').value).split(' '),car=object('GameRef');
 assert.equal(added[0],'car_add');assert.equal(Number(added[2]),handle.id);
 jvm.natives.invoke('java.util.resource.ResourceRef','set',car,[jv('int',Number(added[1]))]);
 assert.equal((await info(car,6))!.value,model.javaTypeId);assert.equal((await info(car,56))!.value,handle.id);
 handle.sync({...pose,position:{x:50,y:3,z:70}});assert.deepEqual(types.get(car)!.position,{x:50,y:3,z:70});assert.deepEqual(types.get(car)!.velocity,pose.velocity);
 handle.remove();handle.remove();types.dispatchQueuedEvents();assert.equal(jvm.get(listener,'calls').value,2);assert.equal(jvm.get(listener,'last').value,`car_rem ${added[1]}`);
 assert.equal(handle.active(),false);
 // Script-owned opponents retain their native car and cannot appear twice.
 const rival=object('GameRef');create(rival,0x700006);types.getResource(rival)!.resourcePack='cars/racers/baiern.rpk';
 const id=Number(call('addTrafficCar',map,[rival,jv('Vector3',null)]).value);assert.ok(id>0);
 call('notifyTrafficCar',map,[jv('int',id),jv('int',1)]);
 const rivalModel=traffic.models(map)!.find(model=>model.registrationId===id)!;
 const moving=bridge.spawn(rivalModel,pose)!;assert.ok(moving);assert.equal(bridge.spawn(rivalModel,pose),undefined);
 moving.remove();assert.ok(types.get(rival));assert.equal(bridge.available(rivalModel),true);
 const again=bridge.spawn(rivalModel,pose)!;assert.equal(again.id,id);
 call('remTrafficCar',other,[jv('int',id)]);assert.equal(again.active(),true);
 call('remTrafficCar',map,[jv('int',id)]);assert.equal(again.active(),false);assert.ok(types.get(rival));assert.equal(bridge.available(rivalModel),false);
 types.dispatchQueuedEvents();assert.equal(jvm.get(listener,'calls').value,6);
 const last=bridge.spawn(model,pose)!;assert.ok(last);
 call('delTraffic',map,[]);assert.equal(last.active(),false);assert.deepEqual(traffic.models(map),[]);assert.equal(bridge.available(model),false);
 traffic.dispose();
 types.dispose();
});

test('Java traffic declarations preserve per-ground resource identities, density weights and parameters',()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),ground=jv('GroundRef',{}),other=jv('GroundRef',{}),taxi=jv('GameRef',{}),bus=jv('GameRef',{});
 const refs=new Map([[taxi.value,{pack:'cars.traffic.Taxi',id:6}],[bus.value,{pack:'cars/traffic/Coach.rpk',id:6}]]);
 const traffic=new TrafficNative(jvm,value=>value.value as object,value=>refs.get(value.value));
 const add=(map:typeof ground,type:typeof taxi,count:number,countType='int')=>jvm.natives.invoke('java.util.resource.GroundRef','addTrafficN',map,[type,jv(countType,count),jv('float',2),jv('float',5),jv('float',2)]);
 const zero=jv('GroundRef',{});add(zero,taxi,0);assert.deepEqual(traffic.models(zero),[],'an explicit zero Java population must not select the preview fallback');
 assert.equal(traffic.models(ground),undefined);assert.equal(add(ground,taxi,40)?.value,1);assert.equal(add(ground,bus,15,'float')?.value,2);
 const snapshot=traffic.models(ground)!;assert.equal(snapshot,traffic.models(ground));assert.deepEqual(snapshot.map(model=>[model.pack,model.id,model.weight,model.parameters]),[['cars/traffic/taxi.rpk',6,40,[2,5,2]],['cars/traffic/coach.rpk',6,15,[2,5,2]]]);
 add(ground,taxi,10);assert.equal(traffic.models(ground)![0].weight,50);assert.equal(snapshot[0].weight,40,'published snapshots stay stable');
 add(other,bus,3);jvm.natives.invoke('java.util.resource.GroundRef','delTraffic',ground,[]);assert.deepEqual(traffic.models(ground),[]);assert.equal(traffic.models(other)![0].weight,3);
 add(ground,taxi,0);add(ground,taxi,-1);assert.deepEqual(traffic.models(ground),[]);
});

test('traffic selection uses Java density proportions, supports fifty slots and respects an explicitly empty catalogue',()=>{
 const models=[{pack:'taxi.rpk',id:6,weight:40},{pack:'bus.rpk',id:6,weight:10}];
 assert.equal(MAX_TRAFFIC_CARS,50);assert.equal(pickTrafficModel(models,()=>.79)?.pack,'taxi.rpk');assert.equal(pickTrafficModel(models,()=>.8)?.pack,'bus.rpk');
 assert.equal(pickTrafficModel([],()=>0),undefined);assert.equal(pickTrafficModel([{...models[0],weight:0}]),undefined);
 assert.equal(pickTrafficModel(models,()=>1)?.pack,'bus.rpk');
});

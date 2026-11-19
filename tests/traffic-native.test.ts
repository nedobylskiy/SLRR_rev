import {test} from 'node:test';import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {TrafficNative} from '../src/runtime/traffic-native';
import {MAX_TRAFFIC_CARS,pickTrafficModel} from '../src/engine/traffic-models';
import {GameTypeNative} from '../src/runtime/game-type-native';
import type {RoadNetwork,RoadSegment} from '../src/formats/trc';

test('null native rival positions are placed on roads before streaming and motion does not replace the model catalogue',async()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{});
 const object=()=>jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
 const map=object(),listener=object(),rival=object();
 for(const ref of [map,listener,rival])jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);
 const segment:RoadSegment={start:[500,0,0],end:[0,0,0],startTangent:[-500,0,0],endTangent:[-500,0,0],length:500,flag:0,raw:new Uint32Array(14)};
 const graph:RoadNetwork={version:1,bytes:0,paths:[],others:[{id:2,refs:[102,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment]}],nodes:[{id:1,group:1,position:[500,0,0],raw:new Uint32Array(4),links:[{target:2,flag:1},{target:3,flag:0}],lanes:[{header:new Uint8Array(12),segment:{...segment,start:[502,0,0],end:[500,0,0],startTangent:[-2,0,0],endTangent:[-2,0,0],length:2}}]}]};
 graph.others.push({...graph.others[0],id:3,segments:[{...segment,start:[1000,0,0],end:[502,0,0]}]});
 const traffic=new TrafficNative(jvm,ref=>types.getResource(ref),value=>value.type==='int'?{pack:'cars.rpk',id:Number(value.value)}:{pack:'rival.rpk',id:6},types,async()=>graph);
 try{
  jvm.natives.invoke('java.util.resource.GroundRef','addTrafficCar',map,[rival,jv('Vector3',null)]);
  let selections=0;
  const catalogue=traffic.models(map)!,model=catalogue[0],bridge=traffic.bridge(map,listener,async()=>{selections++;throw Error('dummycar has no Java Part fields');});
  assert.equal(await bridge.selection(model),undefined);assert.equal(selections,0);
  assert.equal(bridge.paint?.(model),undefined);
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',rival,[jv('ResourceRef',null),jv('int',16),jv('String','texture 42 1')]);
  assert.deepEqual(bridge.paint?.(model),{pack:'cars.rpk',id:42},'the original Java dummycar texture command reaches the rendering bridge');
  assert.equal(bridge.location(model),undefined,'service coordinates must not enter the visible population');
  const focus={x:0,y:0,z:0};await traffic.advanceDistant(map,focus,50,0);
  const first=bridge.location(model)!;assert.ok(first);assert.ok(first.position.x>50);assert.equal(first.position.y,0);
  await traffic.advanceDistant(map,focus,50,5000);
  assert.notDeepEqual(bridge.location(model)!.position,first.position);
  assert.equal(traffic.models(map),catalogue,'five-second position updates must not restart model loading');
  const pose=bridge.location(model)!,handle=bridge.spawn(model,pose)!;assert.ok(handle);
  await traffic.advanceDistant(map,focus,50,10000);assert.deepEqual(bridge.location(model),pose,'visible traffic retains physical ownership');
 }finally{traffic.dispose();types.dispose();}
});

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
 const adopted=traffic.registeredCar(last.id)!;const nativeId=types.getResource(adopted)!.resourceId;
 call('remTrafficCar',map,[jv('int',last.id)]);
 assert.equal(last.active(),false,'a police bot leaves normal traffic');
 assert.ok(types.get(adopted),'remTrafficCar keeps the vehicle adopted by Bot.followCar alive');
 assert.equal(types.getResource(adopted)!.resourceId,nativeId,'the Java car reference retains its original ID');
 last.remove();assert.ok(types.get(adopted),'a late stream cleanup cannot destroy the adopted car');
 const cleanup=bridge.spawn(model,pose)!;assert.ok(cleanup);
 call('delTraffic',map,[]);assert.equal(cleanup.active(),false);assert.deepEqual(traffic.models(map),[]);assert.equal(bridge.available(model),false);
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

test('traffic selection uses Java density proportions, supports five hundred slots and respects an explicitly empty catalogue',()=>{
 const models=[{pack:'taxi.rpk',id:6,weight:40},{pack:'bus.rpk',id:6,weight:10}];
 assert.equal(MAX_TRAFFIC_CARS,500);assert.equal(pickTrafficModel(models,()=>.79)?.pack,'taxi.rpk');assert.equal(pickTrafficModel(models,()=>.8)?.pack,'bus.rpk');
 assert.equal(pickTrafficModel([],()=>0),undefined);assert.equal(pickTrafficModel([{...models[0],weight:0}]),undefined);
 assert.equal(pickTrafficModel(models,()=>1)?.pack,'bus.rpk');
});

import {test} from 'node:test';import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {TrafficNative} from '../src/runtime/traffic-native';
import {MAX_TRAFFIC_CARS,pickTrafficModel} from '../src/engine/traffic-models';

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

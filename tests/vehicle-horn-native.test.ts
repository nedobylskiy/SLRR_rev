import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv,type JavaValue} from 'slrr-jvm';
import {GameTypeNative} from '../src/runtime/game-type-native';
import {ControllerNative} from '../src/runtime/controller-native';
import {InputNative} from '../src/runtime/input-native';
import {VehicleHornNative} from '../src/runtime/vehicle-horn-native';

test('old Chassis horn slots snapshot resources, pitch and explicit silent slots',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),objects=new GameTypeNative(jvm,()=>{});
  const controllers=new ControllerNative(jvm,()=>0);
  const chassis=jv('Chassis',{className:'java.game.parts.bodypart.Chassis',fields:new Map()});
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',chassis,[]);
  const sound=jv('ResourceRef',{className:'java.util.resource.ResourceRef',fields:new Map()});
  const car=jv('Vehicle',{className:'java.game.Vehicle',fields:new Map([['chassis',chassis]])});
  const received:unknown[]=[];
  const horns=new VehicleHornNative(jvm,objects,controllers,{start(settings){received.push(settings);return 1;},stop(){received.push('stop');}},
    ()=>({car,controller:jv('Controller',null)}));
  const set=(id:number,index:number)=>{
    const value=jv('int',id);if(id)value.resource={pack:'sound',id};
    jvm.natives.invoke('java.util.resource.ResourceRef','set',sound,[value]);
    jvm.natives.invoke('java.game.parts.bodypart.Chassis','setHornSFX',chassis,[sound,jv('float',.75),jv('int',index)]);
  };
  const command=async(index:number)=>{
    await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',chassis,[jv('ResourceRef',null),jv('int',16),jv('String',`sethorn ${index}`)]);
    horns.update();
  };
  set(0x15,1);set(0x16,3);set(0,2);
  await command(1);await command(3);await command(2);
  assert.deepEqual(received,[{resource:{pack:'sound',id:0x15},pitch:.75},'stop',
    {resource:{pack:'sound',id:0x16},pitch:.75},'stop']);
  horns.dispose();objects.dispose();
});

test('Java horn follows original H binding, career consumption, vehicle aliases and release',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),objects=new GameTypeNative(jvm,()=>{});
  let input!:InputNative;const controllers=new ControllerNative(jvm,(device,axis)=>input.physicalAxis(device,axis));
  input=new InputNative(jvm,controllers,objects);
  const ref=(name:string):JavaValue=>jv(name,{className:name,fields:new Map()});
  const controller=ref('java.io.Controller'),chassis=ref('java.game.Chassis'),other=ref('java.game.Chassis');
  for(const target of [chassis,other])jvm.natives.invoke('java.lang.GameType','createNativeInstance',target,[]);
  const car=jv('Vehicle',{className:'java.game.Vehicle',fields:new Map([['chassis',chassis]])});
  let player:{car:JavaValue;controller:JavaValue}|undefined={car,controller};
  jvm.natives.invoke('java.io.Controller','user_Add',controller,[jv('int',54),jv('int',0),jv('int',35),...Array.from([0,1,0,1],n=>jv('float',n))]);
  const sounds:string[]=[];
  const horns=new VehicleHornNative(jvm,objects,controllers,{start(){sounds.push('start');return sounds.length;},stop(id){sounds.push(`stop ${id}`);}},()=>player);
  const read=()=>jvm.natives.invoke('java.game.Vehicle','getHorn',car,[])!.value;
  assert.equal(read(),0);horns.update();assert.deepEqual(sounds,[]);
  input.setPhysicalAxis(0,35,1);assert.equal(read(),1);assert.equal(horns.read(other),false);
  horns.update();horns.update();assert.deepEqual(sounds,['start']);
  const alias=ref('java.util.resource.GameRef');
  jvm.natives.invoke('java.util.resource.ResourceRef','set',alias,[jv('int',objects.get(chassis)!.resourceId)]);
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',alias,[jv('ResourceRef',null),jv('int',16),jv('String','sethorn 0')]);
  assert.equal(read(),0,'City may consume the horn through the chassis alias');horns.update();
  assert.equal(read(),0,'held key must not undo the career command');
  input.setPhysicalAxis(0,35,0);horns.update();input.setPhysicalAxis(0,35,1);horns.update();assert.equal(read(),1);
  assert.deepEqual(sounds,['start','stop 1','start']);player=undefined;horns.update();assert.deepEqual(sounds,['start','stop 1','start','stop 3']);
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',other,[jv('ResourceRef',null),jv('int',16),jv('String','sethorn 1')]);
  assert.equal(horns.read(other),true,'Bot sethorn commands work without a player controller');horns.dispose();objects.dispose();
});

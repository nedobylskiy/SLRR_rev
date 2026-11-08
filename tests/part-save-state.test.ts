import { javaPartPreviewSelection } from '../src/runtime/java-part-preview';
import { PartFactory } from '../src/engine/world';
import type { BootResult } from '../src/runtime/game-boot';
import type { Assets } from '../src/assets';
import { Matrix4 } from 'three';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import type { Vehicle3D } from '../src/engine/vehicle-3d';
import type { VehicleDamageState } from '../src/engine/vehicle-damage';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PartNative } from '../src/runtime/part-native';
import { ChassisNative } from '../src/runtime/chassis-native';
import { FileNative } from '../src/runtime/file-native';
import { MemoryKeyValue } from '../src/runtime/key-value';
import { VirtualFileSystem } from '../src/runtime/virtual-file-system';
import { parseSdat } from '../src/formats/sdat';

test('part mesh identity and opaque damage data survive save-native access without affecting other parts', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  new PartNative(jvm, resources); new ChassisNative(jvm, resources);
  const fs = await VirtualFileSystem.load(new MemoryKeyValue()); new FileNative(jvm, fs, resources);
  const ref = () => jv('Part', { className: 'java.game.parts.Part', fields: new Map() });
  const part = ref(), other = ref();
  const call = (method: string, args: ReturnType<typeof jv>[] = [], target = part) =>
    jvm.natives.invoke('java.game.parts.Part', method, target, args)!;
  assert.equal(call('getMesh').value, 0);
  call('setTear',[jv('float',0.5)]);
  assert.equal(call('getTear').value,0.5);
  assert.equal(call('getTear',[],other).value,1);
  const mesh = resources.remountSavedResource('parts/test.rpk', 0x55);
  assert.equal(call('setMesh', [mesh]).value, 1);
  assert.equal(call('getMesh').value, mesh.value);
  assert.deepEqual(call('getMesh').resource, { pack: 'parts/test.rpk', id: 0x55 });
  assert.equal(call('getMesh', [], other).value, 0);
  assert.equal(call('getSlotDamage', [jv('int', 2)]).value, null);
  call('setSlotDamage', [jv('int', 2), jv('String', 'opaque:slot-data')]);
  assert.equal(call('getSlotDamage', [jv('int', 2)]).value, 'opaque:slot-data');
  assert.equal(call('getSlotDamage', [jv('int', 2)], other).value, null);
  call('setSlotDamage', [jv('int', 2), jv('String', null)]);
  assert.equal(call('getSlotDamage', [jv('int', 2)]).value, null);
  const chassisOwner = 'java.game.parts.bodypart.Chassis';
  jvm.natives.invoke(chassisOwner, 'setWheelDamage', part, [jv('int', 3), jv('String', 'opaque:wheel-data')]);
  assert.equal(jvm.natives.invoke(chassisOwner, 'getWheelDamage', part, [jv('int', 3)])!.value, 'opaque:wheel-data');
  const resource = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', resource, [call('getMesh')]);
  const file = jv('File', { className: 'java.io.File', fields: new Map([['name', jv('String', 'save/mesh')]]) });
  jvm.natives.invoke('java.io.File', 'open', file, [jv('int', 1)]);
  jvm.natives.invoke('java.io.File', 'write', file, [resource]);
  jvm.natives.invoke('java.io.File', 'close', file, []);
  assert.deepEqual([...parseSdat(fs.read('save/mesh')!).packs], [[1, 'parts/test.rpk']]);
  resources.dispose();
});


test('native damage is captured before SDAT writes, survives fresh handles and respects mesh repair',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),resources=new GameTypeNative(jvm,()=>{});
  const parts=new PartNative(jvm,resources,async()=>true),fs=await VirtualFileSystem.load(new MemoryKeyValue());
  new FileNative(jvm,fs,resources,()=>parts.flushPhysics());
  const create=()=>{const ref=jv('Part',{className:'java.game.parts.Part',fields:new Map()});
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);return ref;};
  const root=create(),child=create(),cfg=parsePartConfig('slot 0 0 0 0 0 0 10\nslot 0 0 0 0 0 0 20'),own=parsePartConfig('slot 0 0 0 0 0 0 1');
  parts.configure(root,cfg);parts.configure(child,own);
  const rootId=resources.getResource(root)!.resourceId,childId=resources.getResource(child)!.resourceId;
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',child,[jv('ResourceRef',null),jv('int',16),jv('String',`install 0 ${rootId} 1 ${rootId} 10`)]);
  const world=new EngineWorld(),body=world.create({key:{pack:'test.rpk',id:1},alias:'body',cfgPath:'body.cfg',config:cfg});
  const door=world.create({key:{pack:'test.rpk',id:2},alias:'door',cfgPath:'door.cfg',config:own});
  body.nativeId=rootId;door.nativeId=childId;world.install(body,10,door,1);body.condition=.4;door.condition=0;world.detach(door);
  const panel=new DeformablePanel([-1,0,-1,1,0,-1,-1,0,1,1,0,1],{mass:10,mount:[0,0,0],backend:'ts'});
  panel.positions[10]-=.2;panel.beams[0].rest*=.8;panel.mounts[0].broken=true;
  const damage:VehicleDamageState={version:1,parts:[
    {path:[],resource:body.definition.key,local:new Matrix4().toArray(),condition:.4,connected:true,panel:panel.captureDamage(new Matrix4())},
    {path:[10],resource:door.definition.key,local:new Matrix4().toArray(),condition:0,connected:false}],wheels:[]};
  let captures=0;
  const unbind=parts.bindPhysics(root,{root:body,captureDamage:()=>{captures++;return damage;}} as unknown as Vehicle3D);
  jvm.natives.invoke('java.game.parts.Part','setSlotDamage',root,[jv('int',0),jv('String','legacy attachment data')]);
  const file=jv('File',{className:'java.io.File',fields:new Map([['name',jv('String','save/damaged-car')]])});
  jvm.natives.invoke('java.io.File','open',file,[jv('int',1)]);
  assert.equal(captures,1,'opening a save flushes the live state before Part.save can read it');
  assert.equal(jvm.natives.invoke('java.game.parts.Part','slotIDOnSlot',root,[jv('int',10)])!.value,0,'lost parts are not reinstalled or serialized as attached');
  assert.ok(Math.abs(Number(jvm.natives.invoke('java.game.parts.Part','getWear',root,[])!.value)-.4)<1e-6);
  const opaque=jvm.natives.invoke('java.game.parts.Part','getSlotDamage',root,[jv('int',0)])!;
  jvm.natives.invoke('java.io.File','write',file,[opaque]);jvm.natives.invoke('java.io.File','close',file,[]);
  assert.equal(captures,1,'normal native reads do not repeatedly capture the solver');
  unbind();resources.dispose();
  const nextJvm=new SlrrJvm({resolveImport:()=>null}),nextResources=new GameTypeNative(nextJvm,()=>{}),nextParts=new PartNative(nextJvm,nextResources);
  new FileNative(nextJvm,fs,nextResources);
  const fresh=jv('Part',{className:'java.game.parts.Part',fields:new Map()});
  nextJvm.natives.invoke('java.lang.GameType','createNativeInstance',fresh,[]);nextParts.configure(fresh,cfg);
  const input=jv('File',{className:'java.io.File',fields:new Map([['name',jv('String','save/damaged-car')]])});
  nextJvm.natives.invoke('java.io.File','open',input,[jv('int',0)]);
  const text=nextJvm.natives.invoke('java.io.File','readString',input,[])!;
  nextJvm.natives.invoke('java.game.parts.Part','setSlotDamage',fresh,[jv('int',0),text]);
  assert.deepEqual(nextParts.damageFor(fresh),damage,'all cage and mount data survives the SDAT string, without old native pointers');
  nextJvm.natives.invoke('java.game.parts.Part','setMesh',fresh,[jv('int',0)]);
  assert.equal(nextParts.damageFor(fresh)!.parts.length,1,'repairing the chassis mesh clears only its own damage');
  const repaired=String(nextJvm.natives.invoke('java.game.parts.Part','getSlotDamage',fresh,[jv('int',0)])!.value);
  assert.equal(JSON.parse(repaired.slice('SLRR_DAMAGE_1:'.length)).original,'legacy attachment data');
  nextResources.dispose();
});


test('removed damage follows the inventory instance, preview selection and a different mounting slot',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),resources=new GameTypeNative(jvm,()=>{}),parts=new PartNative(jvm,resources,async()=>true);
  const rootCfg=parsePartConfig('slot 0 0 0 0 0 0 10'),nextCfg=parsePartConfig('slot 2 0 0 0 0 0 20'),partCfg=parsePartConfig('slot 0 0 0 0 0 0 1');
  const create=(id:number,cfg:ReturnType<typeof parsePartConfig>)=>{
    const ref=jv('Part',{className:'java.game.parts.Part',fields:new Map()});
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);
    const node=resources.getResource(ref)!;node.typeId=id;node.resourcePack='test.rpk';parts.configure(ref,cfg);return ref;
  };
  const root=create(1,rootCfg),child=create(2,partCfg),other=create(3,nextCfg),replacement=create(2,partCfg);
  const id=(ref:ReturnType<typeof jv>)=>resources.getResource(ref)!.resourceId;
  const command=async(ref:ReturnType<typeof jv>,text:string)=>jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',ref,[jv('ResourceRef',null),jv('int',16),jv('String',text)]);
  await command(child,`install 0 ${id(root)} 1 ${id(root)} 10`);
  const panel=new DeformablePanel([-1,0,-1,1,0,-1,-1,0,1,1,0,1],{mass:10,mount:[0,0,0],backend:'ts'});panel.positions[10]-=.3;
  const shape=panel.captureDamage(new Matrix4());
  const damage:VehicleDamageState={version:1,parts:[{path:[10],resource:{pack:'test.rpk',id:2},condition:.4,connected:true,local:new Matrix4().toArray(),panel:shape}],wheels:[]};
  jvm.natives.invoke('java.game.parts.Part','setSlotDamage',root,[jv('int',0),jv('String','SLRR_DAMAGE_1:'+JSON.stringify({damage,original:null}))]);
  await command(child,'remove 0 0');
  assert.equal(parts.damageFor(root)!.parts.length,0,'the vacant car slot no longer owns the old dent');
  assert.deepEqual(parts.damageFor(child)!.parts[0].path,[]);
  assert.deepEqual(parts.damageFor(child)!.parts[0].panel,shape);
  const result={gameTypes:resources,parts,resolveResourceIdentity:(typeId:number)=>({pack:'test.rpk',id:typeId})} as unknown as BootResult;
  const projected=await javaPartPreviewSelection(result,{} as Assets,child);
  const factory=new PartFactory({} as Assets);
  factory.definition=async key=>({key,alias:'part',cfgPath:'part.cfg',config:partCfg});
  const preview=await factory.stock(projected.key,{javaSelection:projected.selection});
  assert.deepEqual(preview.root.savedDamage?.panel,shape,'the thumbnail model receives the actual cage');
  const opaque=jvm.natives.invoke('java.game.parts.Part','getSlotDamage',child,[jv('int',0)])!;
  assert.ok(String(opaque.value).startsWith('SLRR_DAMAGE_1:'),'a loose leaf part can save its damage on its now-free own slot');
  await command(replacement,`install 0 ${id(root)} 1 ${id(root)} 10`);
  assert.equal(parts.damageFor(replacement),undefined,'an identical new part in the old slot stays undamaged');
  await command(replacement,'remove 0 0');
  const lost=JSON.parse(JSON.stringify(damage));lost.parts[0].connected=false;
  jvm.natives.invoke('java.game.parts.Part','setSlotDamage',root,[jv('int',0),jv('String','SLRR_DAMAGE_1:'+JSON.stringify({damage:lost,original:null}))]);
  await command(replacement,`install 0 ${id(root)} 1 ${id(root)} 10`);
  assert.equal(parts.damageFor(replacement),undefined,'a fresh replacement cannot inherit a physically detached part snapshot either');
  await command(child,`install 0 ${id(other)} 1 ${id(other)} 20`);
  assert.deepEqual(parts.damageFor(other)!.parts[0].path,[20]);
  assert.equal(parts.damageFor(other)!.parts[0].local[12],2,'installation uses the new mount, not the old car position');
  assert.deepEqual(parts.damageFor(other)!.parts[0].panel,shape);
  await command(child,'remove 0 0');
  assert.deepEqual(parts.damageFor(child)!.parts[0].panel,shape,'repeated remove/install does not reset the cage');
  preview.world.dispose();resources.dispose();
});


test('native repair restores the installed car geometry and suspension without repairing loose inventory parts',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),resources=new GameTypeNative(jvm,()=>{}),parts=new PartNative(jvm,resources,async()=>true);
  new ChassisNative(jvm,resources);
  const cfg=parsePartConfig('slot 0 0 0 0 0 0 10\nslot 0 0 0 0 0 0 20'),leaf=parsePartConfig('slot 0 0 0 0 0 0 1');
  const create=(id:number,config:ReturnType<typeof parsePartConfig>)=>{
    const ref=jv('Part',{className:'java.game.parts.Part',fields:new Map()});
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);
    const node=resources.getResource(ref)!;node.typeId=id;node.resourcePack='test.rpk';parts.configure(ref,config);return ref;
  };
  const root=create(1,cfg),hood=create(2,leaf),bumper=create(3,leaf),loose=create(4,leaf);
  const id=(ref:ReturnType<typeof jv>)=>resources.getResource(ref)!.resourceId;
  const command=async(ref:ReturnType<typeof jv>,text:string)=>jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',ref,[jv('ResourceRef',null),jv('int',16),jv('String',text)]);
  await command(hood,`install 0 ${id(root)} 1 ${id(root)} 10`);await command(bumper,`install 0 ${id(root)} 1 ${id(root)} 20`);
  const cage=new DeformablePanel([-1,0,-1,1,0,-1,-1,0,1,1,0,1],{mass:10,mount:[0,0,0],backend:'ts'});
  cage.positions[10]-=.3;cage.beams[0].rest*=.8;cage.mounts[0].broken=true;
  const damage:VehicleDamageState={version:1,parts:[[],[10],[20]].map((path,i)=>({path,resource:{pack:'test.rpk',id:i+1},
    local:new Matrix4().makeTranslation(.1,0,0).toArray(),condition:.4,connected:true,panel:cage.captureDamage(new Matrix4())})),
    wheels:[{damage:new Matrix4().makeTranslation(.2,0,0).toArray(),hardpoint:[.2,0,0],condition:.2}]};
  const store=(ref:ReturnType<typeof jv>,data:VehicleDamageState)=>jvm.natives.invoke('java.game.parts.Part','setSlotDamage',ref,
    [jv('int',0),jv('String','SLRR_DAMAGE_1:'+JSON.stringify({damage:data,original:'damaged mount'}))]);
  store(root,damage);store(loose,{version:1,parts:[{...damage.parts[0],resource:{pack:'test.rpk',id:4}}],wheels:[]});
  jvm.natives.invoke('java.game.parts.bodypart.Chassis','setWheelDamage',root,[jv('int',0),jv('String','damaged wheel')]);
  const result={gameTypes:resources,parts,resolveResourceIdentity:(typeId:number)=>({pack:'test.rpk',id:typeId})} as unknown as BootResult;
  const factory=new PartFactory({} as Assets);factory.definition=async key=>({key,alias:'part',cfgPath:'part.cfg',config:key.id===1?cfg:leaf});
  const before=await javaPartPreviewSelection(result,{} as Assets,root),built=await factory.stock(before.key,{javaSelection:before.selection});
  assert.ok([...built.world.parts.values()].every(part=>part.savedDamage?.panel));
  const revision=parts.visualRevision(root);
  for(const ref of [root,hood,bumper])jvm.natives.invoke('java.game.parts.Part','setWear',ref,[jv('float',1)]);
  await command(root,'repair');
  assert.equal(parts.damageFor(root),undefined);assert.equal(parts.damageFor(hood),undefined);assert.equal(parts.damageFor(bumper),undefined);
  assert.ok(parts.damageFor(loose)?.parts[0].panel,'the parts bin is outside repair-all for the car');
  assert.equal(jvm.natives.invoke('java.game.parts.bodypart.Chassis','getWheelDamage',root,[jv('int',0)])!.value,null);
  assert.equal(jvm.natives.invoke('java.game.parts.Part','getSlotDamage',root,[jv('int',0)])!.value,null);
  assert.ok(parts.visualRevision(root)>revision,'an existing view must be invalidated');
  const after=await javaPartPreviewSelection(result,{} as Assets,root);await factory.syncJavaAssembly(built.root,after.selection);
  assert.equal(built.root.savedVehicleDamage,undefined);assert.equal(built.root.condition,1);
  assert.ok([...built.world.parts.values()].every(part=>part.savedDamage===undefined&&part.condition===1));
  assert.equal(built.root.children.get(10)!.local.elements[12],0,'the damaged attachment offset returns to its CFG frame');
  built.world.dispose();resources.dispose();
});

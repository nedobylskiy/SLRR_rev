import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {GameTypeNative} from '../src/runtime/game-type-native';
import {PartNative} from '../src/runtime/part-native';
import {FileNative} from '../src/runtime/file-native';
import {MemoryKeyValue} from '../src/runtime/key-value';
import {VirtualFileSystem} from '../src/runtime/virtual-file-system';
import {parsePartConfig} from '../src/formats/cfg';
import {parseSdat,serializeSdat} from '../src/formats/sdat';
import {decodePaintJob} from '../src/engine/paint-job';
import {Assets} from '../src/assets';
import {ResourceCatalog} from '../src/runtime/resource-catalog';
import {entryProperties} from '../src/formats/rpk';
import {resourceTextureSource} from '../src/assets';

test('legacy inventory IDs cannot resolve to unrelated decals registered in the next session',async()=>{
  const assets=new Assets([{path:'decals/unowned.png',size:0}],async()=>new Uint8Array());
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{}),fs=await VirtualFileSystem.load(new MemoryKeyValue());
  types.setTextureLoader(source=>assets.registerTexture(source));
  types.restoreTextureIdentity({pack:'__runtime/textures.rpk',id:0,source:'decals/unowned.png'});
  const payload=new Uint8Array(4);new DataView(payload.buffer).setInt32(0,0x10001,true);
  fs.write('save/player',serializeSdat({type:2,flags:0,packs:new Map([[1,'__runtime/textures.rpk']]),unsaved:[],payload}));
  new FileNative(jvm,fs,types);
  const file=jv('File',{className:'java.io.File',fields:new Map([['name',jv('String','save/player')]])});
  jvm.natives.invoke('java.io.File','open',file,[jv('int',0)]);
  const id=jvm.natives.invoke('java.io.File','readResID',file,[])!;
  const key=types.resolveResourceIdentity(Number(id.value))!;
  assert.equal(key.pack,'__runtime/legacy-textures.rpk');
  assert.equal(await resourceTextureSource(assets,key),undefined,'do not substitute a catalog image for the owned item');
  types.dispose();
});

test('runtime texture paths survive a fresh asset library and different texture registration order',async()=>{
  const store=new MemoryKeyValue();
  const runtime=async()=>{
    const assets=new Assets(['paint/red.png','decals/logo.png','unrelated.png'].map(path=>({path,size:0})),async()=>new Uint8Array());
    const jvm=new SlrrJvm({resolveImport:()=>null}),catalog=new ResourceCatalog([]),types=new GameTypeNative(jvm,()=>{},undefined,catalog);
    types.setTextureLoader(source=>{const key=assets.registerTexture(source);catalog.registerTexture(key.pack,key.id,source);return key;});
    const parts=new PartNative(jvm,types),fs=await VirtualFileSystem.load(store);new FileNative(jvm,fs,types);
    const part=()=>{const ref=jv('Part',{className:'java.game.parts.Part',fields:new Map()});jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);parts.configure(ref,parsePartConfig('texture 0x10'));return ref;};
    const file=jv('File',{className:'java.io.File',fields:new Map([['name',jv('String','save/cars/dynamic')]])});
    const io=(method:string,args:ReturnType<typeof jv>[]=[])=>(jvm.natives.invoke('java.io.File',method,file,args))!;
    const texture=(source:string)=>{
      const mounted=types.restoreTextureIdentity({pack:'__runtime/textures.rpk',id:0,source});
      const ref=jv('ResourceRef',{className:'java.util.resource.ResourceRef',fields:new Map()});
      types.bindTexture(ref,types.resolveResourceIdentity(Number(mounted.value))!);
      return jvm.natives.invoke('java.util.resource.ResourceRef','id',ref,[])!;
    };
    return {assets,jvm,types,parts,fs,part,io,texture};
  };
  const first=await runtime(),painted=first.part(),plain=first.part();
  const base=first.texture('paint/red.png'),brush=first.texture('decals/logo.png');
  for(const part of [painted,plain])first.jvm.natives.invoke('java.game.parts.Part','setTexture',part,[base]);
  first.parts.setPaintPickReader(()=>({id:first.types.get(painted)!.resourceId,local:[0,0,0],world:[0,0,0],normal:[0,0,1]}));
  first.parts.setPaintBrushResolver(id=>first.types.resolveResourceIdentity(id));
  first.jvm.natives.invoke('java.game.Painter','doPaint',jv('Painter',{className:'java.game.Painter',fields:new Map()}),
    [jv('GameRef',painted.value),jv('int',-1),brush,jv('int',0),jv('float',0),jv('float',.5),jv('int',0)]);
  assert.equal(first.parts.paintStrokesFor(painted)?.length,1);
  first.io('open',[jv('int',1)]);
  for(const part of [painted,plain]){
    const ref=jv('ResourceRef',{className:'java.util.resource.ResourceRef',fields:new Map()});
    first.jvm.natives.invoke('java.util.resource.ResourceRef','set',ref,[first.jvm.natives.invoke('java.game.parts.Part','getTexture',part,[])!]);
    first.io('write',[ref]);
  }
  first.io('close');await first.fs.flush();
  const saved=parseSdat(first.fs.read('save/cars/dynamic')!);
  assert.ok(![...saved.packs.values()].includes('__runtime/textures.rpk'),'synthetic pack IDs never escape into the SDAT namespace');
  first.types.dispose();
  const second=await runtime();second.texture('unrelated.png');
  second.io('open',[jv('int',0)]);
  const restored=[second.part(),second.part()];
  for(const part of restored)second.jvm.natives.invoke('java.game.parts.Part','setTexture',part,[second.io('readResID')]);
  for(const part of restored){
    const key=second.parts.textureFor(part)!.resource!;
    assert.equal(entryProperties((await second.assets.resource(key.pack,key.id)).entry)[0].value,'paint/red.png');
  }
  const decal=second.parts.paintStrokesFor(restored[0])![0];
  assert.equal(entryProperties((await second.assets.resource(decal.brush.pack,decal.brush.id)).entry)[0].value,'decals/logo.png');
  assert.notEqual(second.parts.textureFor(restored[0])!.resource!.id,base.resource!.id);
  second.types.dispose();
});

test('paint color and committed decals survive SDAT resource saving and a fresh runtime, including a leaf part without slots',async()=>{
  const store=new MemoryKeyValue();
  const runtime=async()=>{
    const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{}),parts=new PartNative(jvm,types),fs=await VirtualFileSystem.load(store);
    new FileNative(jvm,fs,types);
    const part=()=>{const ref=jv('Part',{className:'java.game.parts.Part',fields:new Map()});jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);parts.configure(ref,parsePartConfig('texture 0x10'));return ref;};
    const file=(name:string)=>jv('File',{className:'java.io.File',fields:new Map([['name',jv('String',name)]])});
    const io=(name:string,ref:ReturnType<typeof file>,args:ReturnType<typeof jv>[]=[])=>(jvm.natives.invoke('java.io.File',name,ref,args))!;
    return {jvm,types,parts,fs,part,file,io};
  };
  const first=await runtime(),panels=[first.part(),first.part()],painter=jv('Painter',{className:'java.game.Painter',fields:new Map()});
  const base=first.types.remountSavedResource('paints/colors.rpk',0x25);
  for(const panel of panels)first.jvm.natives.invoke('java.game.parts.Part','setTexture',panel,[base]);
  let picked=panels[0];first.parts.setPaintPickReader(()=>({id:first.types.get(picked)!.resourceId,local:[.1,.2,.3],world:[1,2,3],normal:[0,0,1]}));
  first.jvm.natives.invoke('java.game.Painter','paintPart',painter,[jv('GameRef',picked.value),jv('int',0xff123456|0)]);
  const brush=jv('int',0x12);brush.resource={pack:'decals.rpk',id:0x12};
  const stamp=(temporary:number)=>first.jvm.natives.invoke('java.game.Painter','doPaint',painter,[jv('GameRef',picked.value),jv('int',-1),brush,jv('int',temporary),jv('float',.3),jv('float',.7),jv('int',1)]);
  stamp(0);stamp(1);
  picked=panels[1];first.jvm.natives.invoke('java.game.Painter','paintPart',painter,[jv('GameRef',picked.value),jv('int',0xff000000|0)]);
  assert.equal(first.parts.paintColorFor(panels[0]),0xff123456);
  const file=first.file('save/cars/painted');first.io('open',file,[jv('int',1)]);
  for(const panel of panels){
    const texture=first.jvm.natives.invoke('java.game.parts.Part','getTexture',panel,[])!;
    assert.equal(first.jvm.natives.invoke('java.game.parts.Part','getTexture',panel,[])!.value,texture.value,'unchanged paint reuses its embedded resource');
    const ref=jv('ResourceRef',{className:'java.util.resource.ResourceRef',fields:new Map()});first.jvm.natives.invoke('java.util.resource.ResourceRef','set',ref,[texture]);first.io('write',file,[ref]);
  }
  first.io('close',file);await first.fs.flush();
  const saved=parseSdat(first.fs.read('save/cars/painted')!);assert.equal(saved.unsaved.length,2);
  assert.equal(decodePaintJob(saved.unsaved[0].bytes).strokes.length,1,'temporary decal previews are excluded');first.types.dispose();
  const second=await runtime();second.types.remountSavedResource('other.rpk',1);
  const restored=[second.part(),second.part()],input=second.file('save/cars/painted');second.io('open',input,[jv('int',0)]);
  for(const panel of restored)second.jvm.natives.invoke('java.game.parts.Part','setTexture',panel,[second.io('readResID',input)]);
  assert.equal(second.parts.paintColorFor(restored[0]),0xff123456);assert.equal(second.parts.paintColorFor(restored[1]),0xff000000);
  assert.deepEqual(second.parts.textureFor(restored[0])?.resource,{pack:'paints/colors.rpk',id:0x25});
  assert.equal(second.parts.paintStrokesFor(restored[0])?.length,1);assert.deepEqual(second.parts.paintStrokesFor(restored[0])?.[0].brush,{pack:'decals.rpk',id:0x12});
  assert.deepEqual(second.parts.paintStrokesFor(restored[0])?.[0].position,[.1,.2,.3]);assert.equal(second.parts.paintStrokesFor(restored[0])?.[0].flip,true);
  second.types.dispose();
});

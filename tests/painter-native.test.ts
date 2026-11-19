import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {GameTypeNative} from '../src/runtime/game-type-native';
import {PartNative} from '../src/runtime/part-native';
import {parsePartConfig} from '../src/formats/cfg';
import {partPaint,partPaintTextures,solidPartPaint} from '../src/render/part-paint';
import type {EnginePart} from '../src/engine/world';
import type {Assets} from '../src/assets';
import {InputNative} from '../src/runtime/input-native';
import {ControllerNative} from '../src/runtime/controller-native';
import {Viewer} from '../src/render/viewer';
import {EngineWorld} from '../src/engine/world';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,DataTexture} from 'three';
import {AssetTextureSources} from '../src/render/texture-source-cache';

test('native paint reaches the existing part immediately and a stale assembly cannot replace its overlay state',async()=>{
  const world=new EngineWorld(),part=world.create({key:{pack:'test.rpk',id:1},alias:'panel',cfgPath:'panel.cfg',config:parsePartConfig('texture 0x10')});part.nativeId=42;
  const group=new Group();group.userData.paintKey='default';
  const strokes=[{position:[0,0,.5] as [number,number,number],normal:[0,0,1] as [number,number,number],color:0x66ff0000,brush:{pack:'garage.rpk',id:1},size:.3,rotation:0,flip:false,temporary:false}];
  let finish!:()=>void;const context={proxies:new Map([[part,group]]),livePaint:new WeakMap(),updatePartPaint:()=>new Promise<void>(resolve=>{finish=resolve;})};
  const pending=Viewer.prototype.updateJavaPaint.call(context as unknown as Viewer,42,undefined,strokes,{} as Assets);
  assert.equal(part.paintStrokes,strokes,'the slow assembly path does not delay publication');finish();await pending;
  part.paintStrokes=[];
  let rendered:unknown;
  const update=(Viewer.prototype as unknown as {updatePartPaint:(part:EnginePart,assets:Assets)=>Promise<void>}).updatePartPaint;
  await update.call({...context,updatePartPaintStrokes:async()=>{rendered=part.paintStrokes;}},part,{} as Assets);
  assert.equal(rendered,strokes,'a delayed snapshot cannot remove strokes already drawn by the fast path');world.dispose();
});

test('spray and decal projection produces local geometry and removes a transient preview',async()=>{
  const world=new EngineWorld(),part=world.create({key:{pack:'test.rpk',id:1},alias:'panel',cfgPath:'panel.cfg',config:parsePartConfig('texture 0x10')});
  const group=new Group(),material=new MeshStandardMaterial();material.userData.paintDefault='paint.png';
  group.add(new Mesh(new BoxGeometry(1,1,1),material));
  part.paintStrokes=[{position:[0,0,.5],normal:[0,0,1],color:0x66ff0000,brush:{pack:'garage.rpk',id:1},size:.3,rotation:0,flip:false,temporary:true}];
  const assets={resource:async()=>({entry:{data:new TextEncoder().encode('sourcefile brush.png\n')}}),read:async()=>new Uint8Array()} as unknown as Assets;
  let decoded=0;
  const context={vehicleTextures:new AssetTextureSources(),textureFromPaintBrush:async()=>{decoded++;return new DataTexture(new Uint8Array([255,255,255,255]),1,1);},disposeGroup:(root:Group)=>root.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){(material as MeshStandardMaterial).map?.dispose();material.dispose();}}})};
  const project=(Viewer.prototype as unknown as {updatePartPaintStrokes:(part:EnginePart,assets:Assets,group:Group)=>Promise<void>}).updatePartPaintStrokes;
  await project.call(context,part,assets,group);
  const projected=group.userData.paintStrokeGroup as Group;assert.ok(projected.children.length>0);
  const first=projected.children[0] as Group;
  const mesh=first.children[0] as Mesh;assert.ok(mesh.geometry.getAttribute('position').count>0);
  assert.equal((mesh.material as MeshStandardMaterial).color.getHex(),0xff0000);
  assert.equal((mesh.material as MeshStandardMaterial).opacity,102/255);
  part.paintStrokes=[...part.paintStrokes,{...part.paintStrokes[0],position:[.1,0,.5]}];await project.call(context,part,assets,group);
  assert.equal(projected.children[0],first,'new strokes retain the geometry already on screen');assert.equal(decoded,1,'the brush is decoded once for successive strokes');
  part.paintStrokes=[];await project.call(context,part,assets,group);
  assert.equal(first.parent,null);assert.equal(group.userData.paintStrokeGroup.children.length,0);
  world.dispose();
});

test('Painter follows the cursor pick, commits strokes and clears only a temporary decal on xPaint',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{}),parts=new PartNative(jvm,types);
  const input=new InputNative(jvm,new ControllerNative(jvm),types);parts.setPaintPickReader(()=>input.pickedTarget());
  const edits:{id:number;strokes:unknown}[]=[];parts.setPaintListener((id,_color,strokes)=>edits.push({id,strokes}));
  const make=()=>{const ref=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);return ref;};
  const panel=make(),cursor=make(),painter=jv('Painter',{className:'java.game.Painter',fields:new Map()});parts.configure(panel,parsePartConfig('texture 0x10'));
  input.setPickedTarget({id:types.get(panel)!.resourceId,local:[.2,.3,.4],world:[10,20,30],normal:[0,0,1]});
  jvm.natives.invoke('java.game.Painter','paintPart',painter,[cursor,jv('int',0xff00ff00|0)]);
  assert.equal(parts.paintColorFor(panel),0xff00ff00);assert.equal(parts.paintColorFor(cursor),undefined);
  const brush=jv('int',0x102);brush.resource={pack:'misc/garage.rpk',id:0x102};
  const stroke=(temporary:number)=>jvm.natives.invoke('java.game.Painter','doPaint',painter,[cursor,jv('int',0x66ff0000),brush,jv('int',temporary),jv('float',.5),jv('float',.7),jv('int',1)]);
  stroke(0);stroke(1);assert.equal(parts.paintStrokesFor(panel)?.length,2);
  assert.equal(edits.at(-1)?.id,types.get(panel)!.resourceId);assert.equal(edits.at(-1)?.strokes,parts.paintStrokesFor(panel),'native edits reach the renderer immediately, without an assembly poll');
  assert.deepEqual(parts.paintStrokesFor(panel)?.[0].position,[.2,.3,.4]);
  assert.equal(parts.paintStrokesFor(panel)?.[0].brush.pack,'misc/garage.rpk');
  jvm.natives.invoke('java.game.Painter','xPaint',painter,[jv('GameRef',panel.value)]);
  assert.equal(parts.paintStrokesFor(panel)?.length,1,'persistent spray survives flushing its preview');
  input.setPickedTarget();stroke(0);assert.equal(parts.paintStrokesFor(panel)?.length,1,'no paint hits the last car after the cursor leaves');
  jvm.natives.invoke('java.game.Painter','paintPart',painter,[cursor,jv('int',-1)]);assert.equal(parts.paintColorFor(panel),0xff00ff00);
});

test('Painter fills the picked paintable part through a GameRef alias without repainting its neighbours',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{}),parts=new PartNative(jvm,types);
  const make=(config:string)=>{const ref=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);parts.configure(ref,parsePartConfig(config));return ref;};
  const root=make('texture 0x10'),panel=make('texture 0x10'),glass=make('category 3');types.get(panel)!.setParent(types.get(root)!);
  const alias=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
  jvm.natives.invoke('java.util.resource.ResourceRef','set',alias,[jv('int',types.get(panel)!.resourceId)]);
  const revision=parts.visualRevision(root),painter=jv('Painter',{className:'java.game.Painter',fields:new Map()});
  const paint=(ref=alias)=>jvm.natives.invoke('java.game.Painter','paintPart',painter,[ref,jv('int',0xff12ab34|0)]);
  paint();assert.equal(parts.paintColorFor(panel),0xff12ab34);assert.equal(parts.paintColorFor(alias),0xff12ab34);
  assert.equal(parts.paintColorFor(root),undefined);assert.ok(parts.visualRevision(root)>revision);
  paint(glass);assert.equal(parts.paintColorFor(glass),undefined);
  paint(jv('GameRef',null));
  jvm.natives.invoke('java.game.parts.Part','setTexture',panel,[jv('int',0x20)]);assert.equal(parts.paintColorFor(panel),undefined);
});

test('solid spray paint targets only the authored paint slot and retains the selected RGB',async()=>{
  const part={definition:{key:{pack:'car.rpk',id:1},config:{texture:16}},paintColor:0xff12ab34} as EnginePart;
  const assets={resource:async()=>({entry:{data:new TextEncoder().encode('sourcefile body.png\n')}})} as unknown as Assets;
  const paint=await partPaint(part,assets);assert.deepEqual(paint,{from:'body.png',to:'body.png',color:0xff12ab34});
  assert.deepEqual(partPaintTextures(['glass.png','body.png','trim.png'],paint),['glass.png','body.png','trim.png']);
  const texture=solidPartPaint(paint!.color!);assert.deepEqual([...texture.image.data],[0x12,0xab,0x34,255]);texture.dispose();
});

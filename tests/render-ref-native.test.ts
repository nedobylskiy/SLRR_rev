import assert from 'node:assert/strict';
import { test } from 'node:test';
import {navigatorRouteRibbon} from '../src/render/navigator-view';
import { jv, SlrrJvm, type JavaValue } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { RenderRefNative } from '../src/runtime/render-ref-native';
import { RenderObject } from '../src/runtime/render-object';

const ref = (name: string): JavaValue => jv(name.split('.').at(-1)!, { className: name, fields: new Map() });

test('PaintCan RGB modulation is opaque, while explicit RenderRef ARGB retains alpha',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{});new RenderRefNative(jvm,types);
  const parent=ref('GameRef'),model=ref('RenderRef');jvm.natives.invoke('java.lang.GameType','createNativeInstance',parent,[]);types.createRender(model,parent,null,'cannaatska');
  jvm.natives.invoke('java.util.resource.RenderRef','setColor',model,[jv('int',0x123456)]);assert.equal(types.getRender(model)!.color,0xff123456);
  jvm.natives.invoke('java.util.resource.RenderRef','setColor',model,[jv('int',0)]);assert.equal(types.getRender(model)!.color,0xff000000,'black is visible paint');
  jvm.natives.invoke('java.util.resource.RenderRef','setColor',model,[jv('int',0x80123456)]);assert.equal(types.getRender(model)!.color,0x80123456);
});
const vector = (x: number, y: number, z: number) => jv('Vector3', { className: 'java.lang.Vector3',
  fields: new Map([['x', jv('float', x)], ['y', jv('float', y)], ['z', jv('float', z)]]) });
const ypr = (y: number, p: number, r: number) => jv('Ypr', { className: 'java.lang.Ypr',
  fields: new Map([['y', jv('float', y)], ['p', jv('float', p)], ['r', jv('float', r)]]) });

test('Painter decal model survives duplicate -> id -> RenderRef constructor with its private texture replacement',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),resources=new GameTypeNative(jvm,()=>{});
  new RenderRefNative(jvm,resources);
  const source=ref('RenderRef'),clone=ref('RenderRef'),wrapper=ref('RenderRef'),parent=ref('GameRef'),render=ref('RenderRef');
  const rid=jv('int',0x83);rid.resource={pack:'misc/garage.rpk',id:0x83};
  jvm.natives.invoke('java.util.resource.ResourceRef','set',source,[rid]);
  jvm.natives.invoke('java.util.resource.ResourceRef','duplicate',clone,[jv('ResourceRef',source.value)]);
  const cloned=resources.getResource(clone)!;cloned.resourceReplacements.set(0x103,0x55);cloned.resourceReplacementPacks.set(0x103,'decals.rpk');
  const id=jvm.natives.invoke('java.util.resource.ResourceRef','id',clone,[])!;
  jvm.natives.invoke('java.util.resource.ResourceRef','set',wrapper,[id]);
  assert.equal(resources.getResource(wrapper),cloned);
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',parent,[]);
  resources.createRender(render,parent,wrapper,'decal button');
  assert.deepEqual(resources.getRender(render)!.renderResource,{pack:'misc/garage.rpk',id:0x83});
  assert.equal(resources.getRender(render)!.renderType!.resourceReplacements.get(0x103),0x55);
  assert.equal(resources.getResource(source)!.resourceReplacements.size,0);
});

test('vehicle driver commands identify separate render instances rather than their shared model',async()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),changes:RenderObject[]=[];
 const resources=new GameTypeNative(jvm,()=>{},node=>changes.push(node));new RenderRefNative(jvm,resources);
 const car=ref('java.util.resource.GameRef'),type=ref('java.util.resource.RenderRef');
 jvm.natives.invoke('java.lang.GameType','createNativeInstance',car,[]);
 jvm.natives.invoke('java.util.resource.ResourceRef','newNative',type,[]);
 jvm.natives.invoke('java.util.resource.ResourceRef','set',type,[jv('int',0xd7)]);
 const figures=[ref('java.util.resource.RenderRef'),ref('java.util.resource.RenderRef')];
 for(const figure of figures){jvm.natives.invoke('java.util.resource.ResourceRef','newNative',figure,[]);jvm.natives.invoke('java.util.resource.RenderRef','create',figure,[jv('ResourceRef',car.value),type,jv('String','botfigura-corpse')]);}
 const nodes=figures.map(f=>resources.getRender(f)!);
 assert.notEqual(nodes[0].resourceId,nodes[1].resourceId);
 assert.ok(nodes.every(n=>n.typeId===0xd7));
 for(const [verb,index] of [['corpse 0',0],['renderinstance',1]] as const){
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',car,[jv('ResourceRef',null),jv('int',16),jv('String',`${verb} ${nodes[index].resourceId}`)]);
  assert.equal(nodes[index].nativeVehicleDriver,true);assert.equal(changes.at(-1),nodes[index]);
  if(index===0)assert.equal(nodes[1].nativeVehicleDriver,false);
 }
 resources.dispose();
});

test('RenderRef.create makes a typed visual child and setMatrix moves that instance', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const changes: string[] = [];
  const resources = new GameTypeNative(jvm, () => {}, node => changes.push(`${node.alias}:${node.position.x}`));
  new RenderRefNative(jvm, resources);
  const osd = ref('java.render.Osd'), type = ref('java.util.resource.RenderRef');
  const instance = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', osd, []);
  for (const item of [type, instance]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', type, [jv('int', 0xd7)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'create', instance,
    [jv('ResourceRef', osd.value), type, jv('String', 'Rectangle')]);
  const node = resources.getRender(instance)!;
  assert.ok(node instanceof RenderObject);
  assert.equal(node.parent, resources.getResource(osd));
  assert.equal(node.renderType, resources.getResource(type));
  assert.equal(node.alias, 'Rectangle');
  assert.equal(node.resourceType, 3);
  assert.equal(jvm.natives.invoke('java.util.resource.RenderRef', 'getTypeID', instance, [])?.value, 0xd7);
  jvm.natives.invoke('java.util.resource.RenderRef', 'setMatrix', instance,
    [vector(1, 2, 3), ypr(0.2, 0.3, 0.4)]);
  assert.deepEqual(node.position, { x: 1, y: 2, z: 3 });
  assert.deepEqual(node.orientation, { y: 0.2, p: 0.3, r: 0.4 });
  assert.equal(resources.getResource(type)?.parent, null);
  assert.deepEqual(changes, ['Rectangle:0', 'Rectangle:1']);
  const sibling = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.util.resource.ResourceRef','newNative',sibling,[]);
  jvm.natives.invoke('java.util.resource.RenderRef','create',sibling,[jv('ResourceRef',osd.value),type,jv('String','sibling')]);
  const revision = node.visualRevision;
  jvm.natives.invoke('java.util.resource.RenderRef','setColor',instance,[jv('int',-65536)]);
  assert.equal(node.color,0xffff0000);
  assert.equal(resources.getRender(sibling)?.color,null);
  assert.ok(node.visualRevision > revision);
  assert.equal(changes.at(-1),'Rectangle:1');
});

test('RenderRef.setType changes the instance type without moving it', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  new RenderRefNative(jvm, resources);
  const parent = ref('java.util.resource.GameRef'), first = ref('java.util.resource.RenderRef');
  const second = ref('java.util.resource.RenderRef'), instance = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', parent, []);
  for (const item of [first, second, instance]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', first, [jv('int', 10)]);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', second, [jv('int', 20)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'create', instance,
    [jv('ResourceRef', parent.value), first, jv('String', null)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'setType', instance, [jv('ResourceRef', second.value)]);
  assert.equal(resources.getRender(instance)?.typeId, 20);
  assert.equal(resources.getRender(instance)?.alias, '_renderinst');
  assert.equal(resources.getRender(instance)?.parent, resources.getResource(parent));
});

test('RenderRef.setLight forwards all three source colors from a light resource', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  const colors: { diffuse: number; ambient: number; specular: number }[] = [];
  new RenderRefNative(jvm, resources, undefined, settings => colors.push(settings));
  const sun = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', sun, []);
  assert.equal(jvm.natives.invoke('java.util.resource.RenderRef', 'setLight', sun,
    [jv('int', 0x00d8d4b0), jv('int', 0x00375070), jv('int', 0x00d8d4b0)])?.type, 'void');
  assert.deepEqual(colors, [{ diffuse: 0xd8d4b0, ambient: 0x375070, specular: 0xd8d4b0 }]);
  assert.equal(resources.getResource(sun)?.sceneLightManaged, true);
  const clone = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'duplicate', clone, [jv('ResourceRef', sun.value)]);
  assert.equal(resources.getResource(clone)?.sceneLightManaged, true, 'a cloned scene light must not render twice');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', clone, [jv('int', 29)]);
  assert.equal(resources.getResource(clone)?.sceneLightManaged, false, 'rebinding a handle clears its previous scene-light role');
});

test('RenderRef.setFlare forwards the original texture and settings', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  const received: { textureId: number; count: number; rays: number }[] = [];
  new RenderRefNative(jvm, resources, undefined, undefined, (texture, _light, settings) => {
    received.push({ textureId: texture.resourceId, count: settings.flareCount, rays: settings.rayCount });
  });
  const sun = ref('java.util.resource.RenderRef'), texture = ref('java.util.resource.ResourceRef');
  for (const item of [sun, texture]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', texture, [jv('int', 0x100)]);
  await jvm.natives.invokeAsync('java.util.resource.RenderRef', 'setFlare', sun,
    [texture, jv('int', 0xe4e4e4ff), jv('float', 1), jv('float', 10), jv('int', 15), jv('int', 8)]);
  assert.deepEqual(received, [{ textureId: 0x100, count: 15, rays: 8 }]);
});

test('mock SkidMark line is a releasable resource without a visual instance', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  new RenderRefNative(jvm, resources);
  const parent = ref('java.util.resource.GameRef');
  const line = ref('java.render.SkidMark');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', parent, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', line, []);
  const result = jvm.natives.invoke('java.util.resource.RenderRef', 'lineCreate', line,
    [jv('ResourceRef', parent.value), jv('ResourceRef', null)]);
  assert.equal(result?.value, 1);
  assert.equal(resources.getResource(line)?.parent, resources.getResource(parent));
  assert.equal(resources.getRender(line), undefined);
  jvm.natives.invoke('java.util.resource.RenderRef', 'lineAdd', line,
    [vector(1, 2, 3), vector(0, 1, 0), jv('int', 0xffffffff), jv('float', 1)]);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', line, []);
  assert.equal(resources.getResource(line), undefined);
});

test('plotRoute creates a replaceable navigator ribbon from the last queried route and releases it normally',()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),resources=new GameTypeNative(jvm,()=>{});
 let points:[number,number,number][]|undefined;
 new RenderRefNative(jvm,resources,undefined,undefined,undefined,()=>points);
 const parent=ref('java.util.resource.Dummy'),type=ref('java.util.resource.RenderRef'),line=ref('java.util.resource.RenderRef');
 jvm.natives.invoke('java.lang.GameType','createNativeInstance',parent,[]);
 for(const item of [type,line])jvm.natives.invoke('java.util.resource.ResourceRef','newNative',item,[]);
 const plot=()=>jvm.natives.invoke('java.util.resource.RenderRef','plotRoute',line,[jv('ResourceRef',parent.value),jv('ResourceRef',type.value),jv('int',-65536),jv('float',10),vector(.01,0,.01)]);
 assert.equal(plot()?.value,0);assert.equal(resources.getRender(line),undefined);
 points=[[100,20,200],[110,30,200],[110,40,220]];assert.equal(plot()?.value,1);
 const node=resources.getRender(line)!;assert.equal(node.parent,resources.getResource(parent));assert.equal(node.alias,'navigator_route');assert.deepEqual(node.route?.points,[[1,.002,2],[1.1,.002,2],[1.1,.002,2.2]]);assert.equal(node.route?.color,0xffff0000);assert.equal(node.route?.width,.1);
 points[0][0]=999;assert.equal(node.route?.points[0][0],1,'render data is an independent snapshot');
 const geometry=navigatorRouteRibbon(node.route!.points,node.route!.width);geometry.computeBoundingBox();assert.ok(geometry.getAttribute('position').count===12);assert.ok(geometry.boundingBox!.max.z-geometry.boundingBox!.min.z>=.2);geometry.dispose();
 points=[[0,0,0],[200,0,0]];assert.equal(plot()?.value,1);assert.equal(resources.getRender(line),node);assert.equal(node.route?.points.length,2);
 jvm.natives.invoke('java.util.resource.ResourceRef','destroy',line,[]);assert.equal(resources.getResource(line),undefined);assert.equal(node.resourceType,0);resources.dispose();
});

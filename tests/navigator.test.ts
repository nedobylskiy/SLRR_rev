import {test}from'node:test';import assert from'node:assert/strict';import {SlrrJvm,jv,type JavaObject,type JavaValue}from'slrr-jvm';import {NavigatorNative,navigatorCenter}from'../src/runtime/navigator-native';import {clampNavigatorMarker}from'../src/render/navigator-view';import {RenderObject}from'../src/runtime/render-object';import {GameObject}from'../src/runtime/game-object';import type {GameTypeNative}from'../src/runtime/game-type-native';import type {CameraNative}from'../src/runtime/camera-native';import type {ViewportNative}from'../src/runtime/viewport-native';
const ref=(fields:Record<string,JavaValue>={}):JavaValue=>jv('Object',{className:'test',fields:new Map(Object.entries(fields))});
test('minimap camera bounds use actual grid size, fit small maps, and marker clamps preserve direction',()=>{
 const center=navigatorCenter(-20,50,2,1,{minX:0,maxX:10,minZ:0,maxZ:20});assert.ok(Math.abs(center.x-2)<1e-10&&Math.abs(center.z-18)<1e-10);
 assert.deepEqual(navigatorCenter(100,100,20,2,{minX:0,maxX:10,minZ:0,maxZ:6}),{x:5,z:3});
 const p=clampNavigatorMarker(2,4);assert.ok(Math.abs(p.y-.85)<1e-10);assert.ok(Math.abs(p.x/p.y-.5)<1e-10);assert.deepEqual(clampNavigatorMarker(.2,-.3),{x:.2,y:-.3});
});
test('Java navigator chooses its own tiles and live markers, modes and viewport lifetime',()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),camRef=ref(),vpRef=ref(),moverRef=jv('GameRef',ref().value),tileRef=ref(),symbolRef=ref(),staticRef=ref();
 const camera=new RenderObject(1,'Camera',null,'camera');camera.position.y=4.5;const tile=new RenderObject(2,'RenderRef',null,'navigator_segment');tile.position={x:-10,y:0,z:-10};tile.renderResource={pack:'maps/other/smallmap.rpk',id:1};
 const mover=new GameObject(3,'GameRef',0,null,'car');mover.position={x:120,y:0,z:-150};mover.orientation.y=.8;
 const dynamic=new RenderObject(4,'RenderRef',null,'marker'),fixed=new RenderObject(5,'RenderRef',null,'marker');
 const nodes=new Map<unknown,unknown>([[camRef.value,camera],[tileRef.value,tile],[moverRef.value,mover],[symbolRef.value,dynamic],[staticRef.value,fixed]]),vp={left:.1,top:.2,width:.3,height:.25,priority:12,active:true};
 const resources={getResource:(r:JavaValue)=>nodes.get(r.value),getRender:(r:JavaValue)=>nodes.get(r.value)}as unknown as GameTypeNative;
 const native=new NavigatorNative(jvm,resources,{get:()=>vp}as unknown as ViewportNative,{get:()=>({halfAov:45})}as unknown as CameraNative);
 const list=(entries:JavaValue[])=>ref({elementData:jv('Object[]',entries),elementCount:jv('int',entries.length)});
 const nav=ref({cam:camRef,vp:vpRef,size:jv('float',20),tiles:jv('RenderRef[]',[tileRef]),marker:list([ref({symbol:staticRef,pos:ref({x:jv('float',500),z:jv('float',600)})})]),dynamarker:list([ref({symbol:symbolRef,mover:moverRef})])});
 jvm.natives.invoke('java.game.Navigator','updateNavigator',nav,[moverRef,jv('int',1)]);
 let frame=native.frames(16/9)[0];assert.equal(frame.fov,90,'Camera native stores half the Java FOV');assert.equal(frame.tiles[0].renderResource?.pack,'maps/other/smallmap.rpk');assert.equal(frame.markers.length,2);assert.equal(frame.yaw,.8);assert.equal(frame.markers[1].x,120);
 mover.position.x=180;assert.equal(native.frames(16/9)[0].markers[1].x,180,'live movement needs no new Java array');native.mode='north';assert.equal(native.frames(16/9)[0].yaw,0);vp.active=false;assert.equal(native.frames(16/9).length,0);vp.active=true;(nav.value as JavaObject).fields.set('tiles',jv('RenderRef[]',[]));frame=native.frames(16/9)[0];assert.equal(frame.tiles.length,0,'route-only views never inherit city tiles');camera.resourceType=0;assert.equal(native.frames(16/9).length,0);native.dispose();
});

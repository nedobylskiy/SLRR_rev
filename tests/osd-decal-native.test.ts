import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jv} from 'slrr-jvm';
import {OsdDecalNative} from '../src/runtime/osd-decal-native';
import {GameObject} from '../src/runtime/game-object';
import {ResourceObject} from '../src/runtime/resource-object';
import {RenderObject} from '../src/runtime/render-object';
import type {Assets} from '../src/assets';
import type {GameTypeNative} from '../src/runtime/game-type-native';
import type {OsdLayer} from '../src/osd/osd-layer';

test('legacy decal button becomes an OSD image at its authored pose, follows group visibility and cancels stale loads',async()=>{
  const group=new ResourceObject(1,'java.render.Group'),icon=new GameObject(2,'java.util.resource.GameRef',0,'-.624,-1.175,0 0,0,0','GameRef');icon.setParent(group);
  const type=new ResourceObject(3,'RenderRef');type.resourceReplacements.set(0x103,0x50000008);type.resourceReplacementPacks.set(0x103,'decals.rpk');
  const render=new RenderObject(4,'RenderRef',type,'decal button');render.setParent(icon);render.renderResource={pack:'misc.garage',id:0x83};
  const osd={className:'Osd',fields:new Map([['cam',jv('Camera',{})],['vpAspect',jv('float',1)],['vpWidth',jv('float',1)],['vpHeight',jv('float',1)]])};
  const fields=new Map([['osd',jv('Osd',osd)],['active',jv('int',1)]]),ref=jv('Group',{className:'java.render.Group',fields});
  const resources={reference:()=>ref} as unknown as GameTypeNative;
  let created=0,visible=false,removed=0,bounds:number[]=[],texture:unknown;
  let click:()=>void=()=>assert.fail('missing decal click target'),clicked=0,hitVisible=false,hitRemoved=0;
  const layer={createRectangle:(x:number,y:number,w:number,h:number,z:number,image:unknown)=>{
    created++;bounds=[x,y,w,h,z];texture=image;
    return{node:{classList:{add(){}},remove(){removed++;}},setBounds(){},show(){visible=true;},hide(){visible=false;}};
  },createHitTarget:(_label:string,_x:number,_y:number,_w:number,_h:number,_z:number,action:()=>void)=>{
    click=action;return {node:{remove(){hitRemoved++;}},show(){hitVisible=true;},hide(){hitVisible=false;}};
  }} as unknown as OsdLayer;
  const bridge=new OsdDecalNative({} as Assets,resources,layer,undefined,undefined,async(target,owner)=>{
    assert.equal(target,icon);assert.equal(owner,osd);clicked++;
  });
  const sizes=(bridge as unknown as {sizes:Map<string,Promise<{width:number;height:number}>>}).sizes;
  sizes.set('misc.garage:131',Promise.resolve({width:.41814,height:.41814}));
  assert.equal(bridge.sync(render),true);await Promise.resolve();assert.equal(created,1);
  assert.deepEqual(texture,{pack:'decals.rpk',id:8});assert.ok(bounds[0]<-.4&&bounds[1]>.79,'use the icon creation coordinates instead of its uninitialized native position');
  assert.equal(bounds[4],1);assert.equal(visible,true);
  assert.equal(hitVisible,true);click();assert.equal(clicked,1,'the legacy icon forwards clicks to its original OSD handler');
  fields.set('active',jv('int',0));bridge.syncVisibility();assert.equal(visible,false);
  assert.equal(hitVisible,false);click();assert.equal(clicked,1,'hidden inventory slots cannot change the brush');
  fields.set('active',jv('int',1));bridge.syncVisibility();assert.equal(visible,true);assert.equal(created,1,'visibility ticks do not recreate images');
  bridge.remove(render);assert.equal(removed,1);
  assert.equal(hitRemoved,1);click();assert.equal(clicked,1,'removed slot callbacks cannot select stale decals');
  bridge.sync(render);bridge.remove(render);await Promise.resolve();assert.equal(created,1,'a removed button cannot reappear after loading');bridge.dispose();
});

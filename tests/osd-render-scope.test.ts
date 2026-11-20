import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Group} from 'three';
import {ResourceObject} from '../src/runtime/resource-object';
import {GameObject} from '../src/runtime/game-object';
import {RenderObject} from '../src/runtime/render-object';
import {isOsdRender} from '../src/runtime/osd-render-scope';
import {Viewer} from '../src/render/viewer';
import type {Assets} from '../src/assets';

test('a decal thumbnail nested below a legacy button never renders at the garage origin',async()=>{
  const osd=new ResourceObject(1,'java.render.Group'),button=new GameObject(2,'java.util.resource.GameRef',0,'0,0,0','button');button.setParent(osd);
  const decal=new RenderObject(3,'RenderRef',null,'decal button');decal.setParent(button);decal.renderResource={pack:'misc/garage.rpk',id:0x83};
  assert.equal(isOsdRender(decal),true);
  const scene=new Group(),floating=new Group();scene.add(floating);
  const context={generation:0,javaRenderNodes:new Map([[3,floating]]),javaCharacters:new Map(),javaRenderModels:new Map(),javaRenderLights:new Map(),javaSkyDomeNodes:new Set(),javaRenderTypes:new Map(),javaRenderRequests:new Map(),javaRenderRevisions:new Map(),releaseJavaDriver(){}};
  const assets={resource:()=>assert.fail('UI models must not enter the 3D resource loader')} as unknown as Assets;
  await Viewer.prototype.upsertJavaRenderObject.call(context as unknown as Viewer,decal,assets);
  assert.equal(floating.parent,null);assert.equal(context.javaRenderNodes.has(3),false,'remove a previously leaked preview as well');
  const map=new GameObject(4,'java.util.resource.GroundRef',0,null,'garage');button.setParent(map);assert.equal(isOsdRender(decal),false,'ordinary world-owned models remain eligible');
  const cursor=new GameObject(5,'java.io.MouseCursor',0,null,'cursor');button.setParent(cursor);assert.equal(isOsdRender(decal),true);
});

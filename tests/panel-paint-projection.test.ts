import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,DataTexture,Vector3,Triangle} from 'three';
import {Viewer} from '../src/render/viewer';
import {PanelView} from '../src/render/panel-view';
import {DeformablePanel} from '../src/engine/deformable-panel';
import {EngineWorld,type EnginePart} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';
import {AssetTextureSources} from '../src/render/texture-source-cache';
import type {Assets} from '../src/assets';

test('projected decal geometry stays on an indexed panel through city placement, a dent and rigid motion',async()=>{
 const world=new EngineWorld(),part=world.create({key:{pack:'car.rpk',id:1},alias:'hood',cfgPath:'hood.cfg',config:parsePartConfig('')});
 const group=new Group(),body=new Mesh(new BoxGeometry(100,100,100),new MeshStandardMaterial());
 body.material.userData.paintDefault='paint.png';group.matrixAutoUpdate=false;group.matrix.makeScale(.01,.01,.01);group.add(body);
 part.paintStrokes=[{position:[0,0,.5],normal:[0,0,1],brush:{pack:'decals.rpk',id:8},color:0xffffffff,size:.4,rotation:.3,flip:false,temporary:false}];
 const assets={resource:async()=>({entry:{data:new TextEncoder().encode('sourcefile decal.png\n')}})} as unknown as Assets;
 const context={vehicleTextures:new AssetTextureSources(),textureFromPaintBrush:async()=>new DataTexture(new Uint8Array([255,255,255,255]),1,1),disposeGroup:()=>{}};
 const project=(Viewer.prototype as unknown as {updatePartPaintStrokes:(part:EnginePart,assets:Assets,group:Group)=>Promise<void>}).updatePartPaintStrokes;
 await project.call(context,part,assets,group);
 const overlays:Mesh[]=[];(group.userData.paintStrokeGroup as Group).traverse(node=>{if(node instanceof Mesh)overlays.push(node);});
 assert.ok(overlays.length);
 const samples=Array.from(body.geometry.getAttribute('position').array,v=>v*.01),panel=new DeformablePanel(samples,{mass:10,mount:[0,0,0]});
 const spawn=new Matrix4().makeRotationY(.6).setPosition(90,4,-150),draw=spawn.clone().multiply(new Matrix4().makeScale(.01,.01,.01));
 // A stale garage proxy is deliberately retained until physics binds it.
 const view=new PanelView(group,panel,[samples],draw,spawn);
 panel.advance(1/240);
 const point=new Vector3();
 for(let i=0;i<panel.positions.length;i+=3){
  point.fromArray(panel.positions,i);point.y-=.2+Math.max(0,point.x)*.5;
  point.applyMatrix4(spawn).toArray(panel.positions,i);
 }
 view.update(spawn,false);
 const check=()=>{
  group.updateMatrixWorld(true);
  const position=body.geometry.getAttribute('position'),index=body.geometry.index!,triangle=new Triangle(),closest=new Vector3(),vertex=new Vector3();
  for(const mesh of overlays)for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){
   vertex.fromBufferAttribute(mesh.geometry.getAttribute('position'),i).applyMatrix4(mesh.matrixWorld);
   let distance=Infinity;
   for(let j=0;j<index.count;j+=3){
    triangle.a.fromBufferAttribute(position,index.getX(j)).applyMatrix4(body.matrixWorld);
    triangle.b.fromBufferAttribute(position,index.getX(j+1)).applyMatrix4(body.matrixWorld);
    triangle.c.fromBufferAttribute(position,index.getX(j+2)).applyMatrix4(body.matrixWorld);
    triangle.closestPointToPoint(vertex,closest);distance=Math.min(distance,vertex.distanceTo(closest));
   }
   assert.ok(distance<.0001,`decal vertex floated ${distance} metres above its painted surface`);
  }
 };
 check();view.update(spawn,true);view.update(new Matrix4().makeRotationY(.9).setPosition(100,5,-170),true);check();
 view.dispose();world.dispose();body.geometry.dispose();
 for(const mesh of overlays)mesh.geometry.dispose();
});

import test from 'node:test';import assert from 'node:assert/strict';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Vector3,Matrix4,BufferAttribute} from 'three';
import {RivalPanels,type RivalPanelDefinition} from '../src/engine/rival-panels';
import {RivalPanelView} from '../src/render/rival-panel-view';
import {TrafficVehicle} from '../src/engine/traffic-vehicle';
import {Box3} from 'three';

const definition=():RivalPanelDefinition=>({id:'hood',mass:20,mount:[0,0,.5],root:false,hood:true,samples:Array.from(new BoxGeometry(1.5,.08,1).getAttribute('position').array)});
test('rival panels sleep before impact, freeze within two wall seconds and retain dents until another impact',()=>{
 const model=new RivalPanels([definition()]);for(let i=0;i<100;i++)model.advance(1/60,i*16);assert.equal(model.panels.size,0);
 model.hit(new Vector3(0,-9000,3000),new Vector3(0,0,-.4),20,1400,2000);assert.ok(model.active);assert.equal(model.panels.size,1);
 const panel=model.panels.get('hood')!,initial=panel.positions.slice();for(let i=1;i<100;i++)model.advance(1/60,2000+i*16);
 assert.ok(panel.positions.some((v,i)=>Math.abs(v-initial[i])>.001));assert.ok(panel.positions.every(Number.isFinite));
 const shape=panel.positions.slice(),tick=panel.clock.tick;model.advance(10,4001);assert.equal(model.active,false);assert.equal(panel.clock.tick,tick);assert.deepEqual(panel.positions,shape);
 for(let i=0;i<100;i++)model.advance(.016,5000+i*16);assert.equal(panel.clock.tick,tick);assert.deepEqual(panel.positions,shape);
 model.hit(new Vector3(5000,0,4000),new Vector3(.3,0,-.4),15,1400,7000);model.advance(.016,7016);assert.ok(panel.clock.tick>tick);assert.ok(model.active);
 model.reset();assert.equal(model.active,false);assert.equal(model.panels.size,0);
});
test('rival deformation owns buffers only after an impact and stops vertex uploads after expiry',()=>{
 const group=new Group(),part=new Group();part.name='hood';const mesh=new Mesh(new BoxGeometry(1.5,.08,1),new MeshStandardMaterial());part.add(mesh);group.add(part);group.position.set(100,2,-50);
 const original=mesh.geometry,other=mesh.clone(),view=new RivalPanelView(group,[definition()]);view.update(.016,0);assert.equal(mesh.geometry,original);
 view.physics.hit(new Vector3(0,-9000,3000),new Vector3(0,0,-.4),20,1400,0);view.update(.016,16);
 assert.notEqual(mesh.geometry,original);assert.equal(other.geometry,original);const version=(mesh.geometry.getAttribute('position') as BufferAttribute).version;
 view.update(.016,2001);view.update(.016,3000);assert.equal((mesh.geometry.getAttribute('position') as BufferAttribute).version,version);
 view.reset();assert.equal(mesh.geometry,original);view.dispose();
});
test('traffic forwards local collision loads to rival panels without stacking the whole-body crush field',()=>{
 const vehicle=new TrafficVehicle(new Box3(new Vector3(-1,-.5,-2),new Vector3(1,1,2)),1400,[],{height:()=>0,normal:()=>new Vector3(0,1,0)});
 vehicle.body.setFrame(new Matrix4().makeTranslation(20,1,5));let point:Vector3|undefined;vehicle.panelImpact=(_impulse,p)=>{point=p;};
 vehicle.impact(new Vector3(0,0,10000),new Vector3(20,1,3),20);assert.deepEqual(point?.toArray(),[0,0,-2]);assert.equal(vehicle.crush.version,0);assert.equal(vehicle.collisionVersion,1);
});

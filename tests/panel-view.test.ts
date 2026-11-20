import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { PanelView } from '../src/render/panel-view';

test('paint vertices follow the actual dented surface triangles rather than a rigid overlay plane',()=>{
 const samples=[-1,1,-1,1,1,-1,0,1,1],panel=new DeformablePanel(samples,{mass:10,mount:[0,1,0]});
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(samples.map(v=>v*100),3));geometry.computeVertexNormals();
 const group=new Group();group.matrixAutoUpdate=false;group.matrix.makeScale(.01,.01,.01);
 group.add(new Mesh(geometry,new MeshBasicMaterial()));
 const paint=new Group(),stamp=new Group();group.add(paint);paint.add(stamp);group.userData.paintStrokeGroup=paint;
 const decalGeometry=new BufferGeometry();decalGeometry.setAttribute('position',new Float32BufferAttribute([0,100,0,10,100,0,0,100,10],3));decalGeometry.computeVertexNormals();
 const decal=new Mesh(decalGeometry,new MeshBasicMaterial());decal.userData.paintStroke=true;stamp.add(decal);
 const original=Array.from(decalGeometry.getAttribute('position').array);
 const identity=new Matrix4(),view=new PanelView(group,panel,[samples],new Matrix4().makeScale(.01,.01,.01),identity);
 view.update(identity,true);
 panel.advance(1/240);
 for(let i=0;i<panel.positions.length;i+=3)panel.positions[i+1]-=.7+Math.max(0,panel.positions[i])*.5;
 view.update(identity,false);group.updateMatrixWorld(true);
 const positions=geometry.getAttribute('position');
 const expected=new Vector3().fromBufferAttribute(positions,0).multiplyScalar(.25)
  .addScaledVector(new Vector3().fromBufferAttribute(positions,1),.25)
  .addScaledVector(new Vector3().fromBufferAttribute(positions,2),.5);
 const actual=new Vector3().fromBufferAttribute(decalGeometry.getAttribute('position'),0).applyMatrix4(decal.matrixWorld);
 assert.ok(actual.distanceTo(expected)<1e-6,`paint floats above the dent: ${actual.toArray()} != ${expected.toArray()}`);
 view.update(identity,true);
 const version=(decalGeometry.getAttribute('position') as Float32BufferAttribute).version;
 view.update(new Matrix4().makeTranslation(3,0,2),true);
 assert.equal((decalGeometry.getAttribute('position') as Float32BufferAttribute).version,version,'rigid motion does not reskin decal vertices every frame');
 view.dispose();assert.deepEqual(Array.from(decalGeometry.getAttribute('position').array),original,'garage projection coordinates are restored');
 geometry.dispose();decalGeometry.dispose();
});

test('a decal spanning several parts moves from the garage pose to the city spawn with every panel',()=>{
 const scale=new Matrix4().makeScale(.01,.01,.01),spawn=new Matrix4().makeRotationY(.8).setPosition(500,4,-300);
 const scene=new Group(),samples=[-1,0,-1,1,0,-1,0,0,1];
 const panels=[0,1].map(x=>{
  const group=new Group();group.matrixAutoUpdate=false;group.matrix.makeTranslation(x,0,0).multiply(scale);scene.add(group);
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(samples.map(v=>v*100),3));geometry.computeVertexNormals();group.add(new Mesh(geometry,new MeshBasicMaterial()));
  const paint=new Group();group.add(paint);
  const local=new Vector3((.5-x)*100,0,0),panel=new DeformablePanel(samples,{mass:10,mount:[0,0,0]});
  const frame=spawn.clone().multiply(new Matrix4().makeTranslation(x,0,0));
  // The meshes still have the old garage transform; physics has already placed
  // the assembly at its city spawn before constructing the view.
  const view=new PanelView(group,panel,[samples],frame.clone().multiply(scale),frame);
  return {group,paint,local,panel,view,geometry,x};
 });
 for(let tick=1;tick<=3;tick++){
  const body=spawn.clone().multiply(new Matrix4().makeTranslation(0,0,-tick*5));
  for(const item of panels)item.view.update(body.clone().multiply(new Matrix4().makeTranslation(item.x,0,0)),true);
  scene.updateMatrixWorld(true);
  const expected=new Vector3(.5,0,0).applyMatrix4(body);
  for(const item of panels)assert.ok(item.local.clone().applyMatrix4(item.paint.matrixWorld).distanceTo(expected)<1e-8,
    `fragment on part ${item.x} lost its city placement`);
 }
 for(const item of panels){item.view.dispose();item.geometry.dispose();}
});

test('garage paint overlays remain on the panel when city physics takes over its draw transform',()=>{
 const samples=[-1,1,-1,1,1,-1,0,1,1],panel=new DeformablePanel(samples,{mass:10,mount:[0,1,0]});
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(samples.map(v=>v*100),3));geometry.computeVertexNormals();
 const group=new Group();group.matrixAutoUpdate=false;
 const initial=new Matrix4().makeRotationY(.3).setPosition(100,2,200),scale=new Matrix4().makeScale(.01,.01,.01);
 group.matrix.copy(initial).multiply(scale);group.add(new Mesh(geometry,new MeshBasicMaterial()));
 const decals=new Group();decals.name='Paint strokes';group.add(decals);
 const decalGeometry=new BufferGeometry();decalGeometry.setAttribute('position',new Float32BufferAttribute([10,100,50,20,100,50,10,100,60],3));
 const decal=new Mesh(decalGeometry,new MeshBasicMaterial());decals.add(decal);
 const point=new Vector3(10,100,50);
 const check=(frame:Matrix4)=>{
  group.updateMatrixWorld(true);
  const actual=point.clone().applyMatrix4(decal.matrixWorld),expected=point.clone().applyMatrix4(frame.clone().multiply(scale));
  assert.ok(actual.distanceTo(expected)<1e-8,`decal detached from painted panel: ${actual.toArray()} != ${expected.toArray()}`);
 };
 check(initial);
 const view=new PanelView(group,panel,[samples]);view.update(initial,true);check(initial);
 const moved=new Matrix4().makeRotationY(.8).setPosition(120,3,210);
 view.update(moved,true);check(moved);
 panel.advance(1/240);view.update(moved,false);check(moved);
 view.dispose();assert.equal(decals.matrixAutoUpdate,true,'garage recovers the original attachment update mode');
 group.matrix.copy(initial).multiply(scale);check(initial);
 geometry.dispose();decalGeometry.dispose();
});

test('a rigid panel carries its dented GPU skin, then updates geometry on wake and reset', () => {
  const samples = [-1, 1, -1, 1, 1, -1, 0, 1, 1], panel = new DeformablePanel(samples, { mass: 10, mount: [0, 1, 0] });
  const geometry = new BufferGeometry(), position = new Float32BufferAttribute(samples, 3); geometry.setAttribute('position', position); geometry.computeVertexNormals();
  const group = new Group(); group.matrixAutoUpdate = false; group.add(new Mesh(geometry, new MeshBasicMaterial()));
  const view = new PanelView(group, panel, [samples]), identity = new Matrix4();
  panel.positions[1] -= 0.1; view.update(identity, true);
  const uploaded = Array.from(position.array), version = position.version;
  const moved = new Matrix4().makeRotationZ(0.2).setPosition(2, 3, 1);
  panel.advanceRigid(1 / 240, moved.elements, [0, 0, 0], [0, 0, 0], [0, 0, 0]); view.update(moved, true);
  assert.equal(position.version, version);
  const actual = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), 0).applyMatrix4(group.matrix);
  assert.ok(actual.distanceTo(new Vector3().fromArray(uploaded).applyMatrix4(moved)) < 1e-10);
  panel.positions[1] -= 0.2; panel.advance(1 / 240); view.update(moved, false); assert.ok(position.version > version); assert.ok(group.matrix.equals(identity));
  panel.setAnchorFrame(identity.elements); panel.reset(); view.update(identity, true);
  const expected = [0, 0, 0]; panel.skin(panel.bind(samples.slice(0, 3)), expected);
  assert.ok(new Vector3().fromBufferAttribute(geometry.getAttribute('position'), 0).distanceTo(new Vector3(...expected)) < 1e-6);
  view.dispose(); assert.deepEqual(Array.from(geometry.getAttribute('position').array), samples); geometry.dispose();
});

test('native chassis flares retain their metre-space mounts when the panel skin takes over the draw frame',()=>{
 const samples=[-1,1,-1,1,1,-1,0,1,1],panel=new DeformablePanel(samples,{mass:10,mount:[0,1,0]});
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(samples,3));geometry.computeVertexNormals();
 const group=new Group();group.matrixAutoUpdate=false;
 const initial=new Matrix4().makeTranslation(100,2,200),scale=new Matrix4().makeScale(.01,.01,.01);
 group.matrix.copy(initial).multiply(scale);group.add(new Mesh(geometry,new MeshBasicMaterial()));
 const lamp=new Group();lamp.matrixAutoUpdate=false;lamp.matrix.makeScale(100,100,100).multiply(new Matrix4().makeTranslation(.5,.3,-2));group.add(lamp);
 const mount=lamp.matrix.clone(),view=new PanelView(group,panel,[samples]);
 const check=(frame:Matrix4)=>{group.updateMatrixWorld(true);const actual=new Vector3().setFromMatrixPosition(lamp.matrixWorld),expected=new Vector3(.5,.3,-2).applyMatrix4(frame);assert.ok(actual.distanceTo(expected)<1e-8,`${actual.toArray()} != ${expected.toArray()}`);};
 view.update(initial,true);check(initial);
 const moved=new Matrix4().makeRotationY(.7).setPosition(120,3,210);
 view.update(moved,true);check(moved);
 panel.positions[1]-=.1;panel.advance(1/240);view.update(moved,false);check(moved);
 view.dispose();assert.ok(lamp.matrix.equals(mount));geometry.dispose();
});

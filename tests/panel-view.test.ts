import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { PanelView } from '../src/render/panel-view';

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

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

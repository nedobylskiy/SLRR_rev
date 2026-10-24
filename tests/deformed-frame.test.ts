import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { DeformedFrame } from '../src/engine/deformed-frame';

test('material frames preserve original CFG offsets, then follow translation and bending of the cage', () => {
  const panel = new DeformablePanel([-1, -1, -1, 1, 1, -1, -1, 1, 1, 1, -1, 1], { mass: 100, mount: [0, 0, 0], volume: true });
  const parent = new Matrix4().makeRotationY(0.4).setPosition(3, 2, 1); panel.setAnchorFrame(parent.elements); panel.reset();
  const original = new Matrix4().makeRotationZ(0.3).setPosition(0.4, 0.2, 0.3), mount = new DeformedFrame(panel, parent, original);
  const outside = new DeformedFrame(panel, parent, new Matrix4().setPosition(2, 3, 4));
  assert.ok(mount.local(parent).elements.every((v, i) => Math.abs(v - original.elements[i]) < 1e-10));
  assert.ok(new Vector3().setFromMatrixPosition(outside.local(parent)).distanceTo(new Vector3(2, 3, 4)) < 1e-10);
  const inverse = parent.clone().invert(), point = new Vector3();
  for (let i = 0; i < panel.positions.length; i += 3) { point.fromArray(panel.positions, i).applyMatrix4(inverse); point.y += 0.2 * point.x; point.x += 0.1; point.applyMatrix4(parent).toArray(panel.positions, i); }
  const changed = mount.local(parent);
  assert.ok(new Vector3().setFromMatrixPosition(changed).distanceTo(new Vector3(0.5, 0.28, 0.3)) < 1e-10);
  assert.ok(Math.abs(changed.elements[1] - original.elements[1]) > 0.05);
  assert.ok(Math.abs(changed.determinant() - 1) < 1e-10);
});

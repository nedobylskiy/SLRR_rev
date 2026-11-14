import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry } from 'three';
import { applyRenderColor } from '../src/render/render-color';

test('RenderRef ARGB tint is instance-local and preserves source opacity', () => {
  const material = new MeshStandardMaterial({color:0xffffff,opacity:.5});
  const geometry = new BoxGeometry(), root = new Group();
  const mesh = new Mesh(geometry,material);root.add(mesh);
  applyRenderColor(root,0x80ff0000);
  assert.notEqual(mesh.material,material);
  assert.equal(mesh.material.color.getHex(),0xff0000);
  assert.ok(Math.abs(mesh.material.opacity - .5 * 128 / 255)<1e-8);
  assert.equal(mesh.material.transparent,true);
  assert.equal(material.color.getHex(),0xffffff);
  assert.equal(material.opacity,.5);
  mesh.material.dispose();material.dispose();geometry.dispose();
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { previewMaterial } from '../src/render/preview-material';
import { previewScope } from '../src/runtime/preview-scope';
import { GameObject } from '../src/runtime/game-object';
import { ResourceObject } from '../src/runtime/resource-object';

test('inventory render worlds isolate lights and meshes at the nearest world root', () => {
  const garage = new GameObject(1, 'GroundRef', 0, null, 'garage'); garage.setFlags(0x10);
  const dummy = new GameObject(2, 'java.util.resource.Dummy', 0, null, 'inventory'); dummy.setFlags(0x10);
  dummy.setParent(garage);
  const part = new ResourceObject(3, 'Part'); part.setParent(dummy);
  const light = new ResourceObject(4, 'RenderRef'); light.setParent(dummy);
  const camera = new ResourceObject(5, 'Camera'); camera.setParent(dummy);
  for (const node of [part, light, camera]) assert.equal(previewScope(node), dummy);
  const worldPart = new ResourceObject(6, 'Part'); worldPart.setParent(garage);
  assert.equal(previewScope(worldPart), undefined);
  const nestedRoot = new GameObject(7, 'GroundRef', 0, null, 'other world'); nestedRoot.setFlags(0x10);
  nestedRoot.setParent(dummy); worldPart.setParent(nestedRoot);
  assert.equal(previewScope(worldPart), undefined, 'an outer inventory must not capture another world');
});

test('preview material needs no lights and retains texture alpha and glass settings', () => {
  const map = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({ map, color: 0xaabbcc, transparent: true,
    opacity: 0.6, alphaTest: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const material = previewMaterial(source);
  assert.equal(material.type, 'MeshBasicMaterial');
  assert.equal(material.map, map);
  assert.equal(material.color.getHex(), source.color.getHex());
  assert.equal(material.alphaTest, 0.4); assert.equal(material.opacity, 0.6);
  assert.equal(material.transparent, true); assert.equal(material.depthWrite, false);
  assert.equal(material.side, THREE.DoubleSide); assert.equal(material.fog, false);
  material.dispose(); source.dispose(); map.dispose();
});

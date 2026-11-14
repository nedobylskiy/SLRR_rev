import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { previewMaterial } from '../src/render/preview-material';
import { previewScope } from '../src/runtime/preview-scope';
import { GameObject } from '../src/runtime/game-object';
import { ResourceObject } from '../src/runtime/resource-object';
import { RenderObject } from '../src/runtime/render-object';
import { javaPartPreviewCameras } from '../src/runtime/java-part-preview';
import type { BootResult } from '../src/runtime/game-boot';
import { jv, type JavaValue } from 'slrr-jvm';
import { JavaPartPreviews } from '../src/render/java-part-previews';

test('installing the last inventory item clears the old canvas once and hides it', () => {
  const calls: unknown[] = [];
  const canvas = { hidden: false };
  const state = { result: { cameras: { entries: () => [] } }, views: new Map(), stamp: 'old thumbnail',
    renderer: { domElement: canvas, setScissorTest: (value: boolean) => calls.push(value), clear: () => calls.push('clear') } };
  const render = (JavaPartPreviews.prototype as unknown as { render: () => void }).render;
  render.call(state);
  assert.deepEqual(calls, [false, 'clear'], 'clear the full surface, including the previously occupied slot');
  assert.equal(canvas.hidden, true);
  assert.equal(state.stamp, '', 'a later removal must redraw even at the same camera pose');
  render.call(state);
  assert.equal(calls.length, 2, 'empty inventories do not submit repeated GPU clears');
});

test('paging keeps only the newest camera in a preview slot and ignores inactive viewports', () => {
  const viewport = { active: true }, viewport2 = { active: false };
  const renders = new Map<JavaValue, RenderObject>();
  const entries = [1, 2, 3].map(id => {
    const root = new GameObject(id, 'java.util.resource.Dummy', 0, null, 'inventory'); root.setFlags(0x10);
    new ResourceObject(id + 10, 'Part').setParent(root);
    const render = new RenderObject(id + 20, 'Camera', null, 'preview'); render.setParent(root);
    const ref = jv('Camera', id); renders.set(ref, render);
    return [ref, { viewport: id === 3 ? viewport2 : viewport, priority: 1 }] as const;
  });
  const result = { cameras: { entries: () => entries },
    gameTypes: { getRender: (ref: JavaValue) => renders.get(ref), reference: (part: ResourceObject) => part },
    viewports: { get: (value: object) => value }, jvm: { isInstance: (part: ResourceObject) => part.className === 'Part' },
  } as unknown as BootResult;
  assert.deepEqual(javaPartPreviewCameras(result).map(view => view.ref), [entries[1][0]]);
  entries.pop(); entries.pop();
  assert.deepEqual(javaPartPreviewCameras(result).map(view => view.ref), [entries[0][0]]);
  viewport.active = false;
  assert.deepEqual(javaPartPreviewCameras(result), []);
  viewport.active = true;
  const camera = renders.get(entries[0][0])!;
  const root = camera.parent!;
  for (const child of [...root.children]) if (!(child instanceof RenderObject)) child.setParent(null);
  const can = new RenderObject(99,'java.util.resource.RenderRef',null,'paint can');
  can.renderResource = {pack:'frontend',id:0x21};can.color=0xff00ff00;can.setParent(root);
  const previews = javaPartPreviewCameras(result);
  assert.equal(previews.length,1);
  assert.equal(previews[0].part,undefined);
  assert.equal(previews[0].model,can);
});

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

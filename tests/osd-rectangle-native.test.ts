import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv, type JavaValue } from 'slrr-jvm';
import { OsdRectangleNative } from '../src/runtime/osd-rectangle-native';
import { RenderObject } from '../src/runtime/render-object';
import { ResourceObject } from '../src/runtime/resource-object';
import type { GameTypeNative } from '../src/runtime/game-type-native';
import type { OsdLayer } from '../src/osd/osd-layer';

test('Java Rectangle resources become positioned OSD images and obey Group visibility', () => {
  const osd = { className: 'java.render.Osd', fields: new Map([
    ['vpAspect', jv('float', 16 / 9)], ['vpWidth', jv('float', 1)],
    ['vpHeight', jv('float', 1)], ['cam', jv('Camera', {})],
  ]) };
  const groupObject = { className: 'java.render.Group', fields: new Map<string, JavaValue>([
    ['osd', jv('Osd', osd)], ['active', jv('int', 1)],
  ]) };
  const group = new ResourceObject(1, 'java.render.Group');
  const template = new ResourceObject(2, 'java.util.resource.RenderRef');
  const mesh = new ResourceObject(3, 'java.util.resource.RenderRef');
  mesh.resourceId = 0x40000001;
  mesh.copiedFromResourceId = 9;
  mesh.meshScale = { x: 1.47 * 16 / 9 * 1.2, y: 1.47 * 0.3, z: 1 };
  template.resourceReplacements.set(0xaf, 0xc00d);
  template.resourceReplacements.set(0xd9, mesh.resourceId);
  const render = new RenderObject(4, 'java.util.resource.RenderRef', template, 'Rectangle');
  render.setParent(group);
  render.position = { x: 1.469 * 16 / 9 * 0.2, y: -1.469 * 0.4, z: 0.002 };
  const resources = {
    reference: () => jv('Group', groupObject),
    getByResourceId: (id: number) => id === mesh.resourceId ? mesh : undefined,
  } as unknown as GameTypeNative;
  let bounds: number[] = [], texture: unknown, visible = false, removed = false;
  const layer = { createRectangle(x: number, y: number, w: number, h: number, depth: number, image: unknown) {
    bounds = [x, y, w, h, depth]; texture = image;
    return { node: { remove() { removed = true; } }, setBounds(a: number, b: number, c: number, d: number, e: number) {
      bounds = [a, b, c, d, e];
    }, show() { visible = true; }, hide() { visible = false; } };
  } } as unknown as OsdLayer;
  const rectangles = new OsdRectangleNative(resources, layer, id => id === 0xc00d
    ? { pack: 'frontend', id: 0xc00d } : undefined);
  assert.equal(rectangles.sync(render), true);
  assert.ok(bounds.every((value, index) => Math.abs(value - [0.2, 0.4, 1.2, 0.3, 2][index]) < 0.001));
  assert.deepEqual(texture, { pack: 'frontend.rpk', id: 0xc00d });
  assert.equal(visible, true);
  groupObject.fields.set('active', jv('int', 0));
  rectangles.syncVisibility();
  assert.equal(visible, false);
  rectangles.remove(render);
  assert.equal(removed, true);
});

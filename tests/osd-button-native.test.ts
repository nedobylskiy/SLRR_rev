import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { OsdButtonNative } from '../src/runtime/osd-button-native';
import type { OsdElement } from '../src/osd/osd-layer';

const object = (className: string, fields: Record<string, JavaValue> = {}) =>
  jv(className.split('.').at(-1)!, { className, fields: new Map(Object.entries(fields)) });

test('an OSD PhysicsRef creates an HTML hit target and clicks its Java Button', async () => {
  const source = `package java.render;
    class Clicks { static int count; }
    class Button { void click() { Clicks.count++; } }
    class Vector { Object[] elementData; int elementCount;
      int size() { return elementCount; }
      Object elementAt(int index) { return elementData[index]; }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('java.render.')
    ? { path: 'Button.java', source } : null });
  await jvm.loadClass('java.render.Button');
  await jvm.loadClass('java.render.Vector');
  await jvm.loadClass('java.render.Clicks');
  let clickFromHtml: (() => void) | undefined;
  let bounds: number[] = [];
  let removed = false;
  const node = { remove() { removed = true; } } as unknown as HTMLElement;
  const surface = { createHitTarget(_label: string, x: number, y: number, width: number, height: number,
    _depth: number, action: () => void): OsdElement {
    clickFromHtml = action;
    bounds = [x, y, width, height];
    return { node, setText() {}, setResource() {}, setBounds() {}, show() {}, hide() {} };
  } };
  const bridge = new OsdButtonNative(jvm, surface);
  const osd = object('java.render.Osd', {
    vpAspect: jv('float', 4 / 3), vpWidth: jv('float', 1), vpHeight: jv('float', 1),
  });
  const physics = object('java.util.resource.PhysicsRef');
  const gadget = object('java.render.Button', { phy: physics, disabled: jv('int', 0) });
  const vector = object('java.render.Vector', { elementData: jv('Object[]', [gadget]), elementCount: jv('int', 1) });
  const group = object('java.render.Group', { osd, gadget: vector, active: jv('int', 1) });
  const groupRef = jv('ResourceRef', group.value);
  const nil = jv('Ypr', null);
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'createBox', physics,
    [groupRef, jv('float', 3.917), jv('float', 2.938), jv('float', 0.001), jv('String', ' ')]);
  const position = object('java.lang.Vector3', { x: jv('float', 0), y: jv('float', 0), z: jv('float', 0) });
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'setMatrix', physics, [position, nil]);
  assert.ok(clickFromHtml);
  assert.ok(Math.abs(bounds[2] - 2) < 0.01);
  assert.ok(Math.abs(bounds[3] - 2) < 0.01);
  assert.equal((await jvm.invokeAsync(vector, 'size')).value, 1);
  assert.equal(((await jvm.invokeAsync(vector, 'elementAt', [jv('int', 0)])).value as JavaValue).value, gadget.value);
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  (gadget.value as { fields: Map<string, JavaValue> }).fields.set('disabled', jv('int', 1));
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  bridge.dispose();
  assert.equal(removed, true);
});

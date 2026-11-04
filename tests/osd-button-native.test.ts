import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { OsdButtonNative, osdHitDepth } from '../src/runtime/osd-button-native';
import type { OsdElement } from '../src/osd/osd-layer';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PhysicsRefNative } from '../src/runtime/physics-ref-native';

const object = (className: string, fields: Record<string, JavaValue> = {}) =>
  jv(className.split('.').at(-1)!, { className, fields: new Map(Object.entries(fields)) });

test('an OSD PhysicsRef creates an HTML hit target and clicks its Java Button', async () => {
  const source = `package java.render;
    class Clicks { static int count; static int hover; static int leave; }
    class Gadget { void focus() { Clicks.hover++; } void unfocus() { Clicks.leave++; } }
    class Button extends Gadget { void click() { Clicks.count++; } }
    class Group {}
    class Osd { Gadget pointedGadget;
      void activateText(Group group, Gadget gadget) { pointedGadget = gadget; gadget.focus(); }
      void deactivateText() { pointedGadget.unfocus(); pointedGadget = null; }
    }
    class Vector { Object[] elementData; int elementCount;
      int size() { return elementCount; }
      Object elementAt(int index) { return elementData[index]; }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('java.render.')
    ? { path: 'Button.java', source } : null });
  await jvm.loadClass('java.render.Button');
  await jvm.loadClass('java.render.Vector');
  await jvm.loadClass('java.render.Clicks');
  await jvm.loadClass('java.render.Osd');
  let clickFromHtml: (() => void) | undefined;
  let hoverFromHtml: (() => void) | undefined;
  let leaveFromHtml: (() => void) | undefined;
  let bounds: number[] = [];
  let depth = NaN;
  let removed = false;
  let visible = false;
  const node = { remove() { removed = true; } } as unknown as HTMLElement;
  const surface = { createHitTarget(_label: string, x: number, y: number, width: number, height: number,
    layerDepth: number, action: () => void, hover?: () => void, leave?: () => void): OsdElement {
    clickFromHtml = action;
    hoverFromHtml = hover;
    leaveFromHtml = leave;
    bounds = [x, y, width, height];
    depth = layerDepth;
    return { node, setText() {}, setResource() {}, setBounds(_x, _y, _width, _height, nextDepth) { depth = nextDepth; },
      show() { visible = true; }, hide() { visible = false; } };
  } };
  const resources = new GameTypeNative(jvm, () => {});
  const worldPhysics = new PhysicsRefNative(jvm, resources);
  const bridge = new OsdButtonNative(jvm, surface, undefined, undefined, () => 4 / 3);
  bridge.setWorldPhysics(worldPhysics);
  const cursorEvents: [number, JavaValue][] = [];
  bridge.setCursorEvents((code, physics) => cursorEvents.push([code, physics]));
  const osd = object('java.render.Osd', {
    vpAspect: jv('float', 4 / 3), vpWidth: jv('float', 1), vpHeight: jv('float', 1), cam: jv('Camera', null),
  });
  const physics = object('java.util.resource.PhysicsRef');
  const gadget = object('java.render.Button', { phy: physics, disabled: jv('int', 0) });
  const vector = object('java.render.Vector', { elementData: jv('Object[]', [gadget]), elementCount: jv('int', 1) });
  const group = object('java.render.Group', { osd, gadget: vector, active: jv('int', 1) });
  const groupRef = jv('ResourceRef', group.value);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', group, []);
  const nil = jv('Ypr', null);
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'createBox', physics,
    [groupRef, jv('float', 3.917), jv('float', 2.938), jv('float', 0.001), jv('String', ' ')]);
  const second = object('java.util.resource.PhysicsRef');
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'createBox', second,
    [groupRef, jv('float', 1), jv('float', 1), jv('float', 0.001), jv('String', ' ')]);
  const id = (ref: JavaValue) => jvm.natives.invoke('java.util.resource.ResourceRef', 'id', ref, [])!.value;
  assert.notEqual(id(physics), 0, 'OSD boxes must not match the world hover sentinel');
  assert.notEqual(id(physics), id(second), 'inventory slots have distinct native hit IDs');
  const position = object('java.lang.Vector3', { x: jv('float', 0), y: jv('float', 0), z: jv('float', -0.002) });
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'setMatrix', physics, [position, nil]);
  assert.equal(depth, osdHitDepth(-0.002, bounds[2], bounds[3]));
  (position.value as { fields: Map<string, JavaValue> }).fields.set('z', jv('float', 3));
  jvm.natives.invoke('java.util.resource.PhysicsRef', 'setMatrix', physics, [position, nil]);
  assert.equal(depth, osdHitDepth(3, bounds[2], bounds[3]), 'a moved arrow hotspot must rise above the shield');
  const hotSpot = jvm.natives.invoke('java.util.resource.PhysicsRef', 'getPos', physics, [])!;
  assert.equal(jvm.get(hotSpot, 'z').value, 3);
  (position.value as { fields: Map<string, JavaValue> }).fields.set('z', jv('float', 4));
  assert.equal(jvm.get(hotSpot, 'z').value, 3, 'getPos returns a snapshot of the current hit box position');
  assert.ok(clickFromHtml);
  assert.ok(hoverFromHtml && leaveFromHtml);
  assert.ok(Math.abs(bounds[2] - 2) < 0.01);
  assert.ok(Math.abs(bounds[3] - 2) < 0.01);
  assert.equal(visible, false);
  (osd.value as { fields: Map<string, JavaValue> }).fields.set('cam', object('java.render.Camera'));
  bridge.sync();
  assert.equal(visible, true);
  await bridge.hover(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'hover').value, 1);
  await bridge.leave(physics);
  assert.deepEqual(cursorEvents.map(([code]) => code), [15, 16]);
  assert.equal(cursorEvents[0][1], physics, 'hover carries the native inventory panel hotspot');
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'leave').value, 1);
  assert.equal((await jvm.invokeAsync(vector, 'size')).value, 1);
  assert.equal(((await jvm.invokeAsync(vector, 'elementAt', [jv('int', 0)])).value as JavaValue).value, gadget.value);
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  (osd.value as { fields: Map<string, JavaValue> }).fields.set('cam', jv('Camera', null));
  bridge.sync();
  assert.equal(visible, false);
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  (osd.value as { fields: Map<string, JavaValue> }).fields.set('cam', object('java.render.Camera'));
  bridge.sync();
  (gadget.value as { fields: Map<string, JavaValue> }).fields.set('disabled', jv('int', 1));
  await bridge.activate(physics);
  assert.equal(jvm.get(jv('class', 'java.render.Clicks'), 'count').value, 1);
  bridge.dispose();
  assert.equal(removed, true);
});

test('small arrow hitboxes outrank the central ghost area on the same Java depth plane', () => {
  assert.ok(osdHitDepth(3, 0.11, 0.11) > osdHitDepth(3, 1.15, 0.21));
  assert.ok(osdHitDepth(3, 1.15, 0.21) > osdHitDepth(-0.002, 2, 2));
});


test('OSD drops call Java Button overloads only on enabled visible drop targets', async () => {
  const source = `package java.render;
    class GameRef {}
    class Gadget {}
    class Button extends Gadget {
      Osd osd;
      void drop(GameRef value) { osd.dropObject = value; osd.objectDrops++; osd.dropObject = null; }
      void drop(Gadget value) { osd.dropGadget = value; osd.gadgetDrops++; osd.dropGadget = null; }
    }
    class Group {}
    class Osd { GameRef dropObject; Gadget dropGadget; int objectDrops; int gadgetDrops; }
    class Vector { Object[] elements; int size() { return elements.length; } Object elementAt(int i) { return elements[i]; } }
  `;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Button.java', source }) });
  await jvm.loadClass('java.render.Button'); await jvm.loadClass('java.render.Vector');
  const resources = new GameTypeNative(jvm, () => {}), physics = new PhysicsRefNative(jvm, resources);
  const bridge = new OsdButtonNative(jvm); bridge.setWorldPhysics(physics);
  const osd = object('java.render.Osd', { cam: object('java.render.Camera'), objectDrops: jv('int',0), gadgetDrops: jv('int',0),
    dropObject: jv('GameRef',null), dropGadget: jv('Gadget',null) });
  const hotspot = (enabled: number) => {
    const phy = object('java.util.resource.PhysicsRef');
    const button = object('java.render.Button', { osd, phy, disabled: jv('int',0), dropEnabled: jv('int',enabled) });
    const group = object('java.render.Group', { osd, active: jv('int',1),
      gadget: object('java.render.Vector', { elements: jv('Object[]',[button]) }) });
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',group,[]);
    jvm.natives.invoke('java.util.resource.PhysicsRef','createBox',phy,[jv('ResourceRef',group.value),jv('float',1),jv('float',1),jv('float',0.01),jv('String','drop')]);
    return {phy,button,group};
  };
  try {
    const target = hotspot(1), inventory = hotspot(1), closed = hotspot(0);
    assert.equal(await bridge.dropOn(target.phy,{object:object('java.render.GameRef')}),true);
    assert.equal(jvm.get(osd,'objectDrops').value,1);
    assert.equal(await bridge.dropOn(target.phy,{physics:inventory.phy}),true);
    assert.equal(jvm.get(osd,'gadgetDrops').value,1);
    assert.equal(jvm.get(osd,'dropObject').value,null);
    assert.equal(jvm.get(osd,'dropGadget').value,null);
    assert.equal(await bridge.dropOn(closed.phy,{physics:inventory.phy}),false);
    assert.equal(await bridge.dropOn(target.phy,{physics:target.phy}),false);
    jvm.set(target.button,'disabled',jv('int',1));
    assert.equal(await bridge.dropOn(target.phy,{physics:inventory.phy}),false);
    jvm.set(target.button,'disabled',jv('int',0)); jvm.set(target.group,'active',jv('int',0));
    assert.equal(await bridge.dropOn(target.phy,{physics:inventory.phy}),false);
    assert.equal(jvm.get(osd,'gadgetDrops').value,1);
  } finally { bridge.dispose(); resources.dispose(); }
});

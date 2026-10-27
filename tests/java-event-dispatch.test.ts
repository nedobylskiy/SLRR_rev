import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { ControllerNative } from '../src/runtime/controller-native';
import { EVENT_HOTKEY, GameTypeNative } from '../src/runtime/game-type-native';
import { InputNative } from '../src/runtime/input-native';

const source = `package demo;
class Hotkey { int command; int state; Hotkey(int value) { command = value; } }
class Handler {
  int calls; int last; int state;
  Handler() {}
  void handleEvent(Hotkey hotkey) { calls++; last = hotkey.command; state = hotkey.state; }
  void handleEvent(Object ref, int type, String text) { calls++; last = type; }
  void handleEvent(Object ref, int type, int value) { calls++; last = value; }
}`;

test('native event queue invokes the original Java hotkey handler after an input edge', async () => {
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'demo.java', source } : null });
  const gameTypes = new GameTypeNative(jvm, () => {});
  let input!: InputNative;
  const controllers = new ControllerNative(jvm, (device, axis) => input.physicalAxis(device, axis));
  input = new InputNative(jvm, controllers, gameTypes);
  await jvm.loadClass('demo.Handler');
  const handler = jvm.construct('demo.Handler', []);
  const hotkey = jvm.construct('demo.Hotkey', [jv('int', 73)]);
  const controller = jv('Controller', { className: 'java.io.Controller', fields: new Map() });
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', handler, []);
  jvm.natives.invoke('java.lang.GameType', 'setEventMask', handler, [jv('int', EVENT_HOTKEY)]);
  jvm.natives.invoke('java.io.Controller', 'user_Add', controller,
    [jv('int', 9), jv('int', 0), jv('int', 17), jv('float', 0), jv('float', 1), jv('float', 0), jv('float', 1)]);
  jvm.natives.invoke('java.io.Input', 'createHotkey', jv('class', 'java.io.Input'),
    [jv('int', 9), jv('int', 1), hotkey, jv('GameRef', handler.value), jv('Osd', null), jv('int', 1)]);
  input.checkHotkeys(controller, jv('Osd', null));
  input.setPhysicalAxis(0, 17, 1);
  input.checkHotkeys(controller, jv('Osd', null));
  assert.equal(jvm.get(handler, 'calls').value, 1);
  assert.equal(jvm.get(handler, 'last').value, 73);
  assert.equal(jvm.get(handler, 'state').value, 1);
  input.checkHotkeys(controller, jv('Osd', null));
  input.setPhysicalAxis(0, 17, 0);
  input.checkHotkeys(controller, jv('Osd', null));
  assert.equal(jvm.get(handler, 'calls').value, 1, 'press-only registration ignores release');
  jvm.natives.invoke('java.util.resource.GameRef', 'queueEvent', handler,
    [jv('ResourceRef', null), jv('int', 16), jv('String', 'command')]);
  assert.equal(gameTypes.dispatchQueuedEvents(), 0, 'event mask rejects unsubscribed events');
  jvm.natives.invoke('java.lang.GameType', 'setEventMask', handler, [jv('int', 16)]);
  jvm.natives.invoke('java.util.resource.GameRef', 'queueEvent', handler,
    [jv('ResourceRef', null), jv('int', 16), jv('String', 'command')]);
  assert.equal(gameTypes.dispatchQueuedEvents(), 1);
  assert.equal(jvm.get(handler, 'last').value, 16);
  jvm.natives.invoke('java.lang.GameType', 'setEventMask', handler, [jv('int', 128)]);
  gameTypes.queueIntEvent(handler, jv('GameRef', null), 128, 456);
  assert.equal(gameTypes.dispatchQueuedEvents(), 1);
  assert.equal(jvm.get(handler, 'last').value, 456);

  jvm.natives.invoke('java.io.Input', 'deleteHotkey', jv('class', 'java.io.Input'), [hotkey]);
  const osdHotkey = jvm.construct('demo.Hotkey', [jv('int', 91)]);
  jvm.natives.invoke('java.io.Input', 'createHotkey', jv('class', 'java.io.Input'),
    [jv('int', 30), jv('int', 2), osdHotkey, jv('GameRef', handler.value),
      jv('Osd', handler.value), jv('int', 3)]);
  input.checkHotkeys(controller, jv('Osd', null));
  input.checkHotkeys(controller, jv('Osd', handler.value));
  input.setPhysicalAxis(0, 30, 1);
  input.checkHotkeys(controller, jv('Osd', null));
  assert.equal(jvm.get(handler, 'last').value, 456, 'unfocused OSD cannot receive its hotkey');
  input.checkHotkeys(controller, jv('Osd', handler.value));
  assert.equal(jvm.get(handler, 'last').value, 91);
  assert.equal(jvm.get(handler, 'state').value, 1);
  input.setPhysicalAxis(0, 30, 0);
  input.checkHotkeys(controller, jv('Osd', handler.value));
  assert.equal(jvm.get(handler, 'state').value, 0, 'release event reaches Java');
});

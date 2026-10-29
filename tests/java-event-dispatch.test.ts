import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { ControllerNative } from '../src/runtime/controller-native';
import { EVENT_HOTKEY, EVENT_TIME, GameTypeNative } from '../src/runtime/game-type-native';
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

test('GameType notifications route watched trigger events to a named Java handler', async () => {
  const notificationSource = `package demo; class Listener {
    int calls; int last; String text;
    Listener() {}
    void onTrigger(Object source, int event, String value) { calls++; last = event; text = value; }
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Listener'
    ? { path: 'listener.java', source: notificationSource } : null });
  const gameTypes = new GameTypeNative(jvm, () => {});
  await jvm.loadClass('demo.Listener');
  const listener = jvm.construct('demo.Listener', []);
  const trigger = jv('GameRef', { className: 'demo.Trigger', fields: new Map() });
  for (const object of [listener, trigger])
    jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', object, []);
  jvm.natives.invoke('java.lang.GameType', 'setEventMask', listener, [jv('int', 32)]);
  const args = [trigger, jv('int', 32), jv('int', 0), jv('Object', null), jv('String', 'onTrigger')];
  jvm.natives.invoke('java.lang.GameType', 'addNotification', listener, args);
  gameTypes.queueStringEvent(trigger, jv('GameRef', null), 32, jv('String', 'entered'));
  assert.equal(gameTypes.dispatchQueuedEvents(), 1);
  assert.equal(jvm.get(listener, 'calls').value, 1);
  assert.equal(jvm.get(listener, 'last').value, 32);
  assert.equal(jvm.get(listener, 'text').value, 'entered');
  jvm.natives.invoke('java.lang.GameType', 'remNotification', listener, [trigger, jv('int', 32)]);
  gameTypes.queueStringEvent(trigger, jv('GameRef', null), 32, jv('String', 'left'));
  assert.equal(gameTypes.dispatchQueuedEvents(), 0);
  assert.equal(jvm.get(listener, 'calls').value, 1);
  gameTypes.dispose();
});

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

test('GameType timers deliver EVENT_TIME and can be cancelled', async () => {
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'demo.java', source } : null });
  const gameTypes = new GameTypeNative(jvm, () => {});
  await jvm.loadClass('demo.Handler');
  const handler = jvm.construct('demo.Handler', []);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', handler, []);
  jvm.natives.invoke('java.lang.GameType', 'setEventMask', handler, [jv('int', EVENT_TIME)]);
  jvm.natives.invoke('java.lang.GameType', 'addTimer', handler, [jv('float', 0), jv('int', 42)]);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(jvm.get(handler, 'last').value, 42);
  assert.equal(jvm.get(handler, 'calls').value, 1);
  jvm.natives.invoke('java.lang.GameType', 'addTimer', handler, [jv('float', 0.02), jv('int', 99)]);
  jvm.natives.invoke('java.lang.GameType', 'removeAllTimers', handler, []);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(jvm.get(handler, 'calls').value, 1);
  gameTypes.dispose();
});

test('cooperative input dispatch keeps delivering events while a Java dialog waits', async () => {
  const dialogSource = `package demo;
    class Pause { static native void waitForClick(); }
    class Handler {
      int started; int finished;
      void handleEvent(Object source, int type, int value) {
        started++;
        Pause.waitForClick();
        finished++;
      }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Dialog.java', source: dialogSource } : null });
  const pending: Array<() => void> = [];
  jvm.natives.registerAsync('demo.Pause', 'waitForClick', [], () => new Promise(resolve => {
    pending.push(() => resolve(jv('void', undefined)));
  }));
  const errors: string[] = [];
  const gameTypes = new GameTypeNative(jvm, event => { if (event.level === 'error') errors.push(event.message); });
  await jvm.loadClass('demo.Handler');
  const handler = await jvm.constructAsync('demo.Handler', []);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', handler, []);
  jvm.natives.invoke('java.lang.GameType', 'setEventMask', handler, [jv('int', EVENT_TIME)]);
  gameTypes.queueIntEvent(handler, jv('GameRef', null), EVENT_TIME, 1);
  assert.equal(gameTypes.dispatchQueuedEventsCooperative(), 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(jvm.get(handler, 'started').value, 1);
  gameTypes.queueIntEvent(handler, jv('GameRef', null), EVENT_TIME, 2);
  assert.equal(gameTypes.dispatchQueuedEventsCooperative(), 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(errors, []);
  assert.equal(pending.length, 2);
  assert.equal(jvm.get(handler, 'finished').value, 0);
  for (const resume of pending) {
    resume();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(jvm.get(handler, 'finished').value, 2);
  assert.deepEqual(errors, []);
});

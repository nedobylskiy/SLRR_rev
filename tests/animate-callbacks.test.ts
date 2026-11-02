import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { InputNative } from '../src/runtime/input-native';
import { ControllerNative } from '../src/runtime/controller-native';

test('native animation dispatch reaches Java OSD text processing as well as the active section', async () => {
  const source = `package demo; import java.io.Input;
    class Section { int frames; void animate() { frames++; } }
    class Osd { int character; int frames; void animate() { frames++; character = Input.lastKey() >> 16; } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.') ? { path: 'demo.java', source } : null });
  const events = new GameTypeNative(jvm, () => {});
  let input!: InputNative;
  const controllers = new ControllerNative(jvm, (device, axis) => input.physicalAxis(device, axis));
  input = new InputNative(jvm, controllers, events);
  await jvm.loadClass('demo.Section'); await jvm.loadClass('demo.Osd');
  const section = jvm.construct('demo.Section', []), osd = jvm.construct('demo.Osd', []);
  const register = (object: typeof osd) => jvm.natives.invoke('java.lang.GameType', 'registerCallback', object, [jv('int', 28)]);
  register(section); register(osd);
  input.setKeyboardCode('KeyA', true, 65);
  await events.animateCallbacks(error => { throw error; });
  assert.equal(jvm.get(section, 'frames').value, 1);
  assert.equal(jvm.get(osd, 'character').value, 65, 'OSD consumes the normal input queue without a direct animate call');
  jvm.natives.invoke('java.lang.GameType', 'unregisterCallback', osd, [jv('int', 28)]);
  await events.animateCallbacks(error => { throw error; });
  assert.equal(jvm.get(section, 'frames').value, 2); assert.equal(jvm.get(osd, 'frames').value, 1);
  register(osd); events.dispose();
  await events.animateCallbacks(error => { throw error; });
  assert.equal(jvm.get(osd, 'frames').value, 1, 'disposed hooks cannot update old menus');
});

test('one failing animation hook is reported and disabled without stopping other Java hooks', async () => {
  const source = 'package demo; class Good { int frames; void animate() { frames++; } } class Bad { void animate() { missingNative(); } }';
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'demo.java', source }) });
  const events = new GameTypeNative(jvm, () => {});
  await jvm.loadClass('demo.Good'); await jvm.loadClass('demo.Bad');
  const good = jvm.construct('demo.Good', []), bad = jvm.construct('demo.Bad', []);
  for (const receiver of [bad, good]) jvm.natives.invoke('java.lang.GameType', 'registerCallback', receiver, [jv('int', 28)]);
  const errors: Error[] = [];
  await events.animateCallbacks(error => errors.push(error)); await events.animateCallbacks(error => errors.push(error));
  assert.equal(jvm.get(good, 'frames').value, 2); assert.equal(errors.length, 1);
  assert.match(errors[0].message, /demo.Bad.animate/);
  events.dispose();
});

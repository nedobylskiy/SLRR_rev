import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { SystemNative } from '../src/runtime/system-native';
import type { BootEvent } from '../src/runtime/game-boot';

test('System clocks use seconds and simulation time follows time warp', async () => {
  const source = `package java.lang; class System {
    static native float currentTime(); static native float simTime();
    static native void syncGameTime(float time);
    static native float timeWarp(float speed);
    static native int gc(); static native int compileAll(String path);
    static native int buildNumber();
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) =>
    className === 'java.lang.System' ? { path: 'System.java', source } : null });
  let milliseconds = 1000;
  const native = new SystemNative(jvm, () => {}, () => milliseconds);
  await jvm.loadClass('java.lang.System');
  const system = jv('class', 'java.lang.System');
  milliseconds = 2500;
  assert.equal(jvm.invoke(system, 'currentTime').value, 1.5);
  assert.equal(jvm.invoke(system, 'simTime').value, 1.5);
  assert.equal(jvm.invoke(system, 'timeWarp', [jv('float', 0)]).value, 1);
  milliseconds = 3500;
  assert.equal(jvm.invoke(system, 'currentTime').value, 2.5);
  assert.equal(jvm.invoke(system, 'simTime').value, 1.5);
  assert.equal(jvm.invoke(system, 'timeWarp', [jv('float', 2)]).value, 0);
  milliseconds = 4000;
  assert.equal(jvm.invoke(system, 'simTime').value, 2.5);
  jvm.invoke(system, 'syncGameTime', [jv('float', 3600)]);
  assert.equal(native.gameTime(), 3600);
  assert.equal(jvm.invoke(system, 'gc').value, 0);
  assert.equal(jvm.invoke(system, 'compileAll', [jv('String', 'scripts')]).value, 0);
  assert.equal(jvm.invoke(system, 'buildNumber').value, 940);
});

test('native System and Debug messages reach the game console', async () => {
  const sources = new Map([
    ['java.lang.System', `package java.lang; class System { static native void log(String message); }`],
    ['java.lang.Debug', `package java.lang; class Debug { native void writeFile(String message, String path); static native void giveWarning(String message); }`],
  ]);
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => {
    const source = sources.get(className);
    return source ? { path: `${className}.java`, source } : null;
  } });
  const events: BootEvent[] = [];
  new SystemNative(jvm, event => events.push(event), () => 0);
  await jvm.loadClass('java.lang.System');
  await jvm.loadClass('java.lang.Debug');
  jvm.invoke(jv('class', 'java.lang.System'), 'log', [jv('String', 'ready')]);
  const debug = jvm.construct('java.lang.Debug', []);
  jvm.invoke(debug, 'writeFile', [jv('String', 'loaded'), jv('String', 'system.log')]);
  jvm.invoke(jv('class', 'java.lang.Debug'), 'giveWarning', [jv('String', 'slow')]);
  assert.deepEqual(events.map(event => event.message), ['ready', '[system.log] loaded', 'Warning: slow']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { ControllerNative } from '../src/runtime/controller-native';

const owner = 'java.io.Controller';
const receiver = (): JavaValue => jv('Controller', { className: owner, fields: new Map() });

test('controller mappings are live, per instance, and reset clears them', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const physical = new Map<string, number>([['0:17', 0.75]]);
  const controller = new ControllerNative(jvm, (device, axis) => physical.get(`${device}:${axis}`) ?? 0);
  const first = receiver(), second = receiver();
  const call = (name: string, target: JavaValue, ...args: JavaValue[]) => jvm.natives.invoke(owner, name, target, args);
  assert.equal(call('user_Add', first, jv('int', 5), jv('int', 0), jv('int', 17),
    jv('float', 0), jv('float', 1), jv('float', 0), jv('float', 1))?.value, 1);
  assert.equal(call('user_GetAxisVal', first, jv('int', 5))?.value, 0.75);
  assert.equal(call('user_GetAxisVal', second, jv('int', 5))?.value, 0);
  physical.set('0:17', 0.25);
  assert.equal(controller.read(first, 5), 0.25);
  call('user_Reset', first);
  assert.equal(controller.bindings(first).length, 0);
  assert.equal(call('user_GetAxisVal', first, jv('int', 5))?.value, 0);
});

test('controller removes only the selected binding and resets axis force', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const controller = new ControllerNative(jvm, (_, axis) => axis === 10 ? 1 : 0.5);
  const target = receiver();
  const call = (name: string, ...args: JavaValue[]) => jvm.natives.invoke(owner, name, target, args);
  for (const axis of [10, 11]) call('user_Add', jv('int', 8), jv('int', 0), jv('int', axis),
    jv('float', 0), jv('float', 1), jv('float', 0), jv('float', 1));
  assert.equal(controller.read(target, 8), 1.5);
  assert.equal(call('user_Del', jv('int', 8), jv('int', 0), jv('int', 10))?.value, 0);
  assert.equal(controller.read(target, 8), 0.5);
  call('user_SetAxisForce', jv('int', 8), jv('float', 0), jv('float', 0.8));
  assert.equal(controller.read(target, 8), 0.8);
  call('user_Reset');
  assert.equal(controller.read(target, 8), 0);
});

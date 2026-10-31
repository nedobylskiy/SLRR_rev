import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { VectorNative } from '../src/runtime/vector-native';

const vector = (x: number, y: number, z: number) => jv('Vector3', { className: 'java.lang.Vector3',
  fields: new Map([['x', jv('float', x)], ['y', jv('float', y)], ['z', jv('float', z)]]) });
const ypr = (y: number, p: number, r: number) => jv('Ypr', { className: 'java.lang.Ypr',
  fields: new Map([['y', jv('float', y)], ['p', jv('float', p)], ['r', jv('float', r)]]) });

test('Vector3 native rotations follow SL2 yaw-pitch-roll order and mutate the receiver', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }); new VectorNative(jvm);
  const v = vector(0, 0, -1);
  assert.equal(jvm.natives.invoke('java.lang.Vector3', 'rotate', v, [ypr(Math.PI / 2, 0, 0)])?.value, v.value);
  assert.ok(Math.abs(Number(jvm.get(v, 'x').value) + 1) < 1e-6);
  assert.ok(Math.abs(Number(jvm.get(v, 'z').value)) < 1e-6);
  jvm.natives.invoke('java.lang.Vector3', 'rotate', v, [vector(0, 1, 0), jv('float', -Math.PI / 2)]);
  assert.ok(Math.abs(Number(jvm.get(v, 'z').value) + 1) < 1e-6);
});

test('Vector3 and Ypr native constructors and measurements are available', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }); new VectorNative(jvm);
  const forward = vector(0, 0, 0);
  jvm.natives.invoke('java.lang.Vector3', '<init>', forward, [ypr(0, 0, 0)]);
  assert.equal(jvm.get(forward, 'z').value, -1);
  const orientation = ypr(0, 0, 0);
  jvm.natives.invoke('java.lang.Ypr', '<init>', orientation, [forward]);
  assert.equal(jvm.get(orientation, 'y').value, 0);
  assert.equal(jvm.get(orientation, 'p').value, 0);
  const v = vector(3, 0, 4);
  assert.equal(jvm.natives.invoke('java.lang.Vector3', 'length', v, [])?.value, 5);
  assert.equal(jvm.natives.invoke('java.lang.Vector3', 'distance', v, [vector(0, 0, 0)])?.value, 5);
  jvm.natives.invoke('java.lang.Vector3', 'normalize', v, []);
  assert.ok(Math.abs(Number(jvm.get(v, 'x').value) - 0.6) < 1e-6);
});

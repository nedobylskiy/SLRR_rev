import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { MathNative } from '../src/runtime/math-native';

const mathClass = jv('class', 'java.lang.Math');
function setup() {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  new MathNative(jvm);
  const call = (name: string, ...args: JavaValue[]) => jvm.invoke(mathClass, name, args);
  return { jvm, call };
}

test('Math methods used by game Java are registered with their argument types', () => {
  const { jvm } = setup();
  for (const [method, types] of [
    ['abs', ['int']], ['abs', ['float']], ['avg', ['float[]']], ['chaos', []],
    ['cos', ['int']], ['cos', ['float']], ['deg2rad', ['int']], ['pow', ['float', 'float']],
    ['rad2deg', ['float']], ['random', []], ['randomize', []], ['remDiv', ['int', 'int']],
    ['round', ['float']], ['section', ['int', 'int', 'int']], ['sin', ['int']],
    ['siRandom', []], ['sqr', ['float']], ['sqrt', ['float']],
  ] as const) assert.equal(jvm.natives.has('java.lang.Math', method, types), true, `${method}(${types.join(',')})`);
  assert.equal(jvm.get(mathClass, 'PI').value, Math.fround(3.141592264175415));
  assert.equal(jvm.get(mathClass, 'TAU').value, Math.fround(6.283185005187988));
});

test('Math preserves SLRR angle overloads, inclusive section, and round threshold', () => {
  const { call } = setup();
  assert.ok(Math.abs(Number(call('sin', jv('int', 90)).value) - 1) < 0.001);
  assert.ok(Math.abs(Number(call('sin', jv('float', Math.PI / 2)).value) - 1) < 0.001);
  assert.ok(Math.abs(Number(call('cos', jv('int', 180)).value) + 1) < 0.001);
  assert.ok(Math.abs(Number(call('deg2rad', jv('int', 180)).value) - Math.PI) < 0.001);
  assert.ok(Math.abs(Number(call('rad2deg', jv('float', Math.PI)).value) - 180) < 0.001);
  assert.equal(call('section', jv('int', 1), jv('int', 3), jv('int', 3)).value, 1);
  assert.equal(call('section', jv('int', 1), jv('int', 3), jv('int', 4)).value, 0);
  assert.equal(call('round', jv('float', 1.44)).value, 1);
  assert.equal(call('round', jv('float', 1.46)).value, 2);
});

test('Math random seed, arrays, and remDiv have reusable game-session state', () => {
  const { jvm, call } = setup();
  call('setrandseed', jv('int', 42));
  const sequence = [call('random').value, call('random').value];
  call('setrandseed', jv('int', 42));
  assert.deepEqual([call('random').value, call('random').value], sequence);
  assert.ok(sequence.every(value => Number(value) >= 0 && Number(value) < 1));
  assert.equal(call('avg', jv('float[]', [2, 4, 6])).value, 4);
  assert.equal(call('total', jv('int[]', [2, 4, 6])).value, 12);
  const quotient = call('remDiv', jv('int', 50), jv('int', 8));
  assert.equal(jvm.get(quotient, 'i').value, 6);
  assert.equal(jvm.get(quotient, 'f').value, 2);
  assert.equal(call('remDiv', jv('int', 50), jv('int', 0)).value, null);
});

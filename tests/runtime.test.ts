import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRegistry, LegacyDllBridge, parseLegacyPrototype } from '../src/runtime/native-registry';
import { FixedClock } from '../src/runtime/fixed-clock';

test('overloads resolve by descriptor; unknown native never silently succeeds', () => {
  const registry = new NativeRegistry();
  registry.register('Object', 'runMethod', '(I)I', (_o, a) => Number(a[0]) + 1);
  registry.register('Object', 'runMethod', '(F)I', (_o, a) => Number(a[0]) + 2);
  assert.equal(registry.invoke('Object', 'runMethod', '(I)I', null, [3]), 4);
  assert.equal(registry.invoke('Object', 'runMethod', '(F)I', null, [3]), 5);
  assert.throws(() => registry.invoke('Object', 'missing', '()V', null, []));
});
test('legacy runDLL preserves string ABI and 64-bit integers without Number coercion', () => {
  const bridge = new LegacyDllBridge();
  bridge.register('test.dll', 'identity', 'uint64:uint64', a => a[0]);
  assert.equal(bridge.runDLL('TEST.DLL', 'identity', 'uint64:uint64', ['18446744073709551615']), '18446744073709551615');
  assert.deepEqual(parseLegacyPrototype('uint'), { result: 'uint', args: [] });
  assert.throws(() => bridge.runDLL('test.dll', 'identity', 'int:int', ['3']));
  assert.throws(() => bridge.runDLL('test.dll', 'identity', 'uint64:uint64', []));
  assert.throws(() => bridge.runDLL('unknown.dll', 'x', 'int', []));
  assert.throws(() => parseLegacyPrototype('int:'));
});
test('simulation ticks are independent of render cadence, with explicit retained backlog', () => {
  const a = new FixedClock(60, 100), b = new FixedClock(60, 100), ticks: number[] = [];
  for (let i = 0; i < 60; i++) a.advance(1 / 60, () => {});
  for (let i = 0; i < 30; i++) b.advance(1 / 30, () => {});
  assert.equal(a.tick, b.tick); assert.equal(a.tick, 60);
  const c = new FixedClock(60, 8); const result = c.advance(1, tick => ticks.push(tick));
  assert.equal(result.steps, 8); assert.equal(result.backlogTicks, 52);
  assert.deepEqual(ticks, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.throws(() => c.advance(-1, () => {}));
});

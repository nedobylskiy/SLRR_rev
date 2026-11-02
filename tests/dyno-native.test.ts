import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { DynoNative } from '../src/runtime/dyno-native';

test('Java DynoData builds a finite RPM table from its engine fields', async () => {
  const fields = new Map([
    ['cylinders', jv('float', 6)], ['bore', jv('float', 0.08)],
    ['stroke', jv('float', 0.09)], ['Vmin', jv('float', 0.000048)],
    ['maxRPM', jv('float', 7000)], ['mixture_H', jv('float', 1_000_000)],
    ['mixture_ratio', jv('float', 14)], ['intercooling', jv('float', 1)],
    ['time_burn', jv('float', 0.003)], ['in_min', jv('float', 0.005)],
    ['in_max', jv('float', 0.8)], ['out_min', jv('float', 0.005)],
    ['out_max', jv('float', 0.8)], ['time_in_open', jv('float', 0.001)],
    ['time_in_close', jv('float', 0.25)], ['time_out_open', jv('float', 0.75)],
    ['time_out_close', jv('float', 0.99)], ['time_spark_min', jv('float', 0.48)],
    ['time_spark_inc', jv('float', -0.05)], ['time_spark_RPM0', jv('float', 2000)],
    ['time_spark_RPM1', jv('float', 5000)],
  ]);
  const outputFields = ['Displacement', 'Compression', 'maxTorque', 'RPM_maxTorque', 'maxHP', 'RPM_maxHP'];
  const source = `package java.game.parts; class DynoData {
    ${[...fields.keys(), ...outputFields].map(name => `float ${name};`).join('\n')}
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.game.parts.DynoData'
    ? { path: 'DynoData.java', source } : null });
  const native = new DynoNative(jvm);
  await jvm.loadClass('java.game.parts.DynoData');
  const dyno = jvm.construct('java.game.parts.DynoData', []);
  for (const [name, value] of fields) jvm.set(dyno, name, value);
  const call = (name: string, args: ReturnType<typeof jv>[]) =>
    jvm.natives.invoke('java.game.parts.DynoData', name, dyno, args)!;
  call('newNative', []);
  assert.equal(call('calcDyno', [jv('int', 28)]).value, 0);
  const curve = native.curve(dyno)!;
  assert.equal(curve.rpmStep, 250);
  assert.equal(curve.torque.length, 28);
  assert.ok(curve.torque.every(value => Number.isFinite(value) && value >= 0));
  assert.ok(Number(jvm.get(dyno, 'Displacement').value) > 0.0027);
  assert.ok(Number(jvm.get(dyno, 'maxTorque').value) > 0);
  assert.ok(Number(jvm.get(dyno, 'maxHP').value) > 0);
  const torque = Number(call('getTorque', [jv('float', 3375), jv('float', 0)]).value);
  assert.ok(torque > 0);
  assert.ok(Math.abs(torque - (curve.torque[13] + curve.torque[14]) / 2) < 0.001);
  assert.equal(call('getTorque', [jv('float', 7000), jv('float', 0)]).value, 0);
  assert.equal(call('getHP', [jv('float', -1), jv('float', 0)]).value, 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { ChassisNative } from '../src/runtime/chassis-native';
import { parsePartConfig } from '../src/formats/cfg';
import { ackermannSteerAngle } from '../src/engine/suspension-3d';

test('Chassis reads the CFG steering limit during its Java constructor and retains later tuning', async () => {
  const sources = new Map([
    ['java.game.parts.bodypart.Chassis', `package java.game.parts.bodypart;
      class Chassis { float max_steer = 0.7;
        Chassis(int id) { setMaxSteering(getMaxSteer()); }
        native float getMaxSteer(); native void setMaxSteer(float value); native void setAckermann(float value);
        void setMaxSteering(float value) { setMaxSteer(value); max_steer = value; }
      }`],
    ['java.game.cars.Sample', `package java.game.cars; import java.game.parts.bodypart.*;
      class Sample extends Chassis { Sample(int id) { super(id); } }`],
  ]);
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => {
    const source = sources.get(className);
    return source ? { path: `${className}.java`, source } : null;
  } });
  const native = new ChassisNative(jvm);
  await jvm.loadClass('java.game.cars.Sample');
  native.prepare('java.game.cars.Sample', 0.65, 2.736);
  const car = jvm.construct('java.game.cars.Sample', [jv('int', 1)]);
  assert.equal(jvm.invoke(car, 'getMaxSteer').value, Math.fround(0.65));
  assert.equal(jvm.get(car, 'max_steer').value, Math.fround(0.65));
  assert.deepEqual(native.steering(car), { maxSteer: Math.fround(0.65), ackermann: 2.736 });
  jvm.invoke(car, 'setMaxSteering', [jv('float', 0.8)]);
  assert.equal(jvm.invoke(car, 'getMaxSteer').value, Math.fround(0.8));
  assert.equal(jvm.get(car, 'max_steer').value, Math.fround(0.8));
  jvm.invoke(car, 'setAckermann', [jv('float', 2.5)]);
  assert.equal(native.steering(car).ackermann, Math.fround(2.5));
});

test('CFG Ackermann length gives distinct inner and outer wheel angles', () => {
  const cfg = parsePartConfig('maxsteer 0.65 2.736');
  assert.equal(cfg.maxSteer, 0.65);
  assert.equal(cfg.ackermann, 2.736);
  const left = ackermannSteerAngle(cfg.maxSteer, -0.709, cfg.ackermann);
  const right = ackermannSteerAngle(cfg.maxSteer, 0.709, cfg.ackermann);
  assert.ok(left > 0.65 && right < 0.65 && right > 0);
  assert.equal(ackermannSteerAngle(-0.65, -0.709, cfg.ackermann), -right);
  assert.equal(ackermannSteerAngle(0.65, -0.709, 0), 0.65);
  assert.equal(ackermannSteerAngle(0.65, -0.709, cfg.ackermann, 0), 0);
  assert.equal(parsePartConfig('maxsteer 0.65').ackermann, undefined);
});

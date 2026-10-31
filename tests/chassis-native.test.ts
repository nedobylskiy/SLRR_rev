import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { ChassisNative } from '../src/runtime/chassis-native';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PartNative } from '../src/runtime/part-native';
import { parsePartConfig } from '../src/formats/cfg';
import { ackermannSteerAngle } from '../src/engine/suspension-3d';

test('GII_RENDER reports the installed chassis camera count from its CFG', () => {
  const cfg = parsePartConfig(`camera -0.390 0.251 0.132 0 0 0
camera 0.010 0.196 -0.928 0 0 0 120
camera 0.010 -0.266 -2.011 0 0 0`);
  assert.equal(cfg.cameras.length, 3);
  assert.equal(cfg.cameras[1]!.fov, 120);
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const gameTypes = new GameTypeNative(jvm, () => {});
  const parts = new PartNative(jvm, gameTypes);
  gameTypes.setRenderCountReader(receiver => parts.cameraCount(receiver));
  const chassis = jv('Chassis', { className: 'java.game.parts.bodypart.Chassis', fields: new Map() });
  const vehicle = jv('Vehicle', { className: 'java.game.Vehicle', fields: new Map([['chassis', chassis]]) });
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', vehicle, []);
  parts.configure(chassis, cfg);
  const count = () => jvm.natives.invoke('java.util.resource.GameRef', 'getInfo', vehicle,
    [jv('int', 48), jv('int', 0)])!.value;
  assert.equal(count(), 3);
  parts.configure(chassis, parsePartConfig('camera 0 0 0 0 0 0'));
  assert.equal(count(), 1);
  parts.configure(chassis, parsePartConfig(''));
  assert.equal(count(), 0);
});

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
  const native = new ChassisNative(jvm, new GameTypeNative(jvm, () => {}));
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

test('forceUpdate runs Java calculations before projecting chassis and nested installed parts', async () => {
  const sources = new Map([
    ['java.game.parts.Part', 'package java.game.parts; public class Part {}'],
    ['java.game.parts.bodypart.Chassis', `package java.game.parts.bodypart;
      import java.game.parts.Part;
      public class Chassis extends Part {
        int suspend_update = 0; int updates = 0; int gears = 5;
        float C_drag = 0.3; float engine_rpm_idle = 800.0;
        float[] ratio = new float[2];
        public native void forceUpdate();
        public void updatevariables() { updates = updates + 1; C_drag = 0.5; ratio[0] = 3.5; }
      }`],
  ]);
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => {
    const source = sources.get(className);
    return source ? { path: `${className}.java`, source } : null;
  } });
  const gameTypes = new GameTypeNative(jvm, () => {});
  const native = new ChassisNative(jvm, gameTypes);
  await jvm.loadClass('java.game.parts.bodypart.Chassis');
  const car = jvm.construct('java.game.parts.bodypart.Chassis', []);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', car, []);
  const part = jv('Part', { className: 'java.game.parts.Part', fields: new Map() });
  const nested = jv('Part', { className: 'java.game.parts.Part', fields: new Map() });
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', part, [jv('GameRef', car.value)]);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', nested, [jv('GameRef', part.value)]);
  await jvm.invokeAsync(car, 'forceUpdate');
  assert.equal(jvm.get(car, 'updates').value, 1);
  assert.equal(native.updateState(car)?.parameters.C_drag, 0.5);
  assert.deepEqual(native.updateState(car)?.ratios, [3.5, 0]);
  assert.deepEqual(native.updateState(car)?.descendantPartIds,
    [gameTypes.get(part)?.resourceId, gameTypes.get(nested)?.resourceId]);
  jvm.set(car, 'suspend_update', jv('int', 1));
  await jvm.invokeAsync(car, 'forceUpdate');
  assert.equal(jvm.get(car, 'updates').value, 1);
  assert.equal(native.updateState(car)?.revision, 2);
});

test('Chassis indexes four wheels and each WheelRef wrapper shares its wheel state', async () => {
  const sources = new Map([
    ['java.game.parts.WheelRef', `package java.game.parts; public class WheelRef {
      public native void setDrive(float value); public native float getDrive();
      public native void setInstantCenter(float hx, float hy, float hz, float lx, float ly, float lz);
    }`],
    ['java.game.parts.bodypart.Chassis', `package java.game.parts.bodypart;
      import java.game.parts.WheelRef;
      public class Chassis { int wheels = 4;
        public native int getWheels(); public native WheelRef getWheel(int index);
      }`],
  ]);
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => {
    const source = sources.get(className);
    return source ? { path: `${className}.java`, source } : null;
  } });
  const gameTypes = new GameTypeNative(jvm, () => {});
  const native = new ChassisNative(jvm, gameTypes);
  await jvm.loadClass('java.game.parts.bodypart.Chassis');
  const car = jvm.construct('java.game.parts.bodypart.Chassis', []);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', car, []);
  assert.equal(jvm.invoke(car, 'getWheels').value, 4);
  assert.equal(jvm.invoke(car, 'getWheel', [jv('int', -1)]).value, null);
  assert.equal(jvm.invoke(car, 'getWheel', [jv('int', 4)]).value, null);
  const first = jvm.invoke(car, 'getWheel', [jv('int', 1)]);
  const again = jvm.invoke(car, 'getWheel', [jv('int', 1)]);
  assert.notEqual(first.value, again.value);
  jvm.invoke(first, 'setDrive', [jv('float', 0.7)]);
  assert.equal(jvm.invoke(again, 'getDrive').value, Math.fround(0.7));
  jvm.invoke(again, 'setInstantCenter', Array(6).fill(jv('float', 10000)));
  assert.deepEqual(native.wheelState(car, 1)?.instantCenter, Array(6).fill(10000));
  assert.equal(native.wheelState(car, 0), undefined);
});

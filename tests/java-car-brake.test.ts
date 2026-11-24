import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { JavaCarBrake } from '../src/runtime/java-car-brake';
import type { DrivingInput } from '../src/engine/driving-demo';

test('the finish-line "brake" command brakes the player car to a halt, then hands control back', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }), types = new GameTypeNative(jvm, () => {});
  const ref = () => jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  const car = ref(), bot = ref();
  for (const r of [car, bot]) jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', r, []);
  // Java Vehicle.command(...) arrives as an EVENT_COMMAND queueEvent on the car.
  const command = (target: typeof car, text: string) => jvm.natives.invokeAsync('java.util.resource.GameRef', 'queueEvent', target, [jv('ResourceRef', null), jv('int', 16), jv('String', text)]);
  const brake = new JavaCarBrake(types, car);
  const full: DrivingInput = { throttle: 1, steer: .3, brake: false, brakeAxis: 0, serviceBrakeAxis: 0, handbrakeAxis: 0 };
  try {
    assert.deepEqual(brake.apply(full, 30), full, 'no effect before the finish');
    await command(bot, 'brake');
    assert.deepEqual(brake.apply(full, 30), full, "a rival's brake command is not the player's");
    await command(car, 'brake'); // City.event_handlerNrFinish / event_handlerRaceFinish
    const held = brake.apply(full, 30);
    assert.equal(held.throttle, 0); assert.equal(held.brake, true); assert.equal(held.serviceBrakeAxis, 1);
    assert.equal(held.steer, .3, 'the driver can still steer while braking');
    assert.equal(brake.apply(full, 0.2), full, 'stopped: the street race sends no "start", so control returns');
    assert.equal(brake.active, false);
    await command(car, 'brake'); await command(car, 'start');
    assert.equal(brake.apply(full, 30), full, 'Java "start" also releases it');
    brake.dispose(); await command(car, 'brake');
    assert.equal(brake.apply(full, 30), full, 'a disposed session ignores later commands');
  } finally { types.dispose(); }
});

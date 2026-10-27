import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { PartNative } from '../src/runtime/part-native';
import { GameTypeNative } from '../src/runtime/game-type-native';

test('Java part wear belongs to each instance while tear remains pristine', async () => {
  const source = `package java.game.parts; class Part {
    native float getWear(); native float setWear(float value);
    native float getTear(); native float setTear(float value);
    native void setMaxWear(float value);
    native int getTexture(); native int setTexture(int id);
    float condition() { return getWear() * getTear(); }
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) =>
    className === 'java.game.parts.Part' ? { path: 'Part.java', source } : null });
  const native = new PartNative(jvm, new GameTypeNative(jvm, () => {}));
  await jvm.loadClass('java.game.parts.Part');
  const worn = jvm.construct('java.game.parts.Part', []);
  const newPart = jvm.construct('java.game.parts.Part', []);
  assert.equal(jvm.invoke(worn, 'getWear').value, 1);
  assert.equal(jvm.invoke(worn, 'setWear', [jv('float', 0.4)]).value, Math.fround(0.4));
  assert.equal(jvm.invoke(worn, 'getWear').value, Math.fround(0.4));
  assert.equal(jvm.invoke(newPart, 'getWear').value, 1);
  assert.equal(jvm.invoke(worn, 'setTear', [jv('float', 0.2)]).value, Math.fround(0.2));
  assert.equal(jvm.invoke(worn, 'getTear').value, 1);
  assert.equal(jvm.invoke(worn, 'condition').value, Math.fround(0.4));
  jvm.invoke(worn, 'setMaxWear', [jv('float', 500)]);
  assert.equal(native.wearLimit(worn), 500);
  assert.equal(jvm.invoke(worn, 'getTexture').value, 0);
  assert.equal(jvm.invoke(worn, 'setTexture', [jv('int', 196650)]).value, 1);
  assert.equal(jvm.invoke(worn, 'getTexture').value, 196650);
  assert.equal(jvm.invoke(newPart, 'getTexture').value, 0);
});

test('Part.getCar resolves the installed chassis across nested parts and returns zero for loose parts', async () => {
  const sources = new Map([
    ['java.game.parts.Part', 'package java.game.parts; public class Part { public native int getCar(); }'],
    ['java.game.parts.bodypart.BodyPart', 'package java.game.parts.bodypart; import java.game.parts.Part; public class BodyPart extends Part {}'],
    ['java.game.parts.bodypart.Chassis', 'package java.game.parts.bodypart; public class Chassis extends BodyPart {}'],
    ['java.game.cars.TestCar', 'package java.game.cars; import java.game.parts.bodypart.Chassis; public class TestCar extends Chassis {}'],
  ]);
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => {
    const source = sources.get(className);
    return source ? { path: `${className}.java`, source } : null;
  } });
  await jvm.loadClass('java.game.cars.TestCar');
  const gameTypes = new GameTypeNative(jvm, () => {});
  new PartNative(jvm, gameTypes);
  const ref = (className: string) => jv(className, { className, fields: new Map() });
  const inventory = ref('java.game.Inventory');
  const car = ref('java.game.cars.TestCar');
  const part = ref('java.game.parts.Part');
  const nested = ref('java.game.parts.Part');
  const loose = ref('java.game.parts.Part');
  const create = (receiver: ReturnType<typeof ref>, parent?: ReturnType<typeof ref>) => {
    jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', receiver,
      parent ? [jv('GameRef', parent.value)] : []);
  };
  create(inventory);
  create(car, inventory);
  create(part, car);
  create(nested, part);
  create(loose, inventory);
  const getCar = (receiver: ReturnType<typeof ref>) =>
    jvm.natives.invoke('java.game.parts.Part', 'getCar', receiver, [])?.value;
  assert.equal(getCar(car), gameTypes.get(car)?.resourceId);
  assert.equal(getCar(part), gameTypes.get(car)?.resourceId);
  assert.equal(getCar(nested), gameTypes.get(car)?.resourceId);
  assert.equal(getCar(loose), 0);
  gameTypes.get(part)?.setParent(gameTypes.getResource(inventory) ?? null);
  assert.equal(getCar(nested), 0);
});

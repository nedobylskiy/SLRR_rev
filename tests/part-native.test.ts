import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { PartNative } from '../src/runtime/part-native';

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
  const native = new PartNative(jvm);
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

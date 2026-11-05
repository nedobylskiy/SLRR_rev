import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';

for (const asynchronous of [false, true]) test(`typed null String does not select an unrelated Vector overload (${asynchronous ? 'async' : 'sync'})`, async () => {
  const source = `class Vector {} class Sink {
    native int write(String text);
    int write(Vector values) { return -99; }
    int save() { String damage; return write(damage); }
  }`;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Sink.java', source }) });
  jvm.natives.register('Sink', 'write', ['String'], ({ args }) => {
    assert.equal(args[0].value, null); return jv('int', 4);
  });
  await jvm.loadClass('Sink');
  const receiver = await jvm.constructAsync('Sink', []);
  assert.equal((asynchronous ? await jvm.invokeAsync(receiver, 'save') : jvm.invoke(receiver, 'save')).value, 4);
});


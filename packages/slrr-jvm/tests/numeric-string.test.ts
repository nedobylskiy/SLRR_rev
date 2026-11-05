import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';

const source = `package demo; class Main {
  String text;
  void printValue(String format) { text = format; }
  String run(float value) { printValue(value); return text; }
  String choose(float value) { return "float"; }
  String choose(String value) { return "String"; }
  String strings(String value) { return value; }
}`;
test('numeric arguments reach interpreted String methods only in the enabled compatibility mode', async () => {
  const strict = new SlrrJvm({ resolveImport: () => ({ path: 'Main.java', source }) });
  await strict.loadClass('demo.Main');
  assert.throws(() => strict.invoke(strict.construct('demo.Main', []), 'run', [jv('float', 1.25)]), /method\/native missing/);
  const jvm = new SlrrJvm({ allowNumericStringArguments: true, resolveImport: () => ({ path: 'Main.java', source }) });
  await jvm.loadClass('demo.Main'); const main = jvm.construct('demo.Main', []);
  for (const invoke of [jvm.invoke.bind(jvm), jvm.invokeAsync.bind(jvm)]) {
    assert.deepEqual(await invoke(main, 'run', [jv('float', -1.25)]), jv('String', '-1.25'));
    for (const type of ['int', 'float', 'double'])
      assert.deepEqual(await invoke(main, 'strings', [jv(type, 2)]), jv('String', '2'));
    assert.equal((await invoke(main, 'choose', [jv('float', 2)])).value, 'float');
    assert.equal((await invoke(main, 'strings', [jv('String', '%.3f')])).value, '%.3f');
    assert.equal((await invoke(main, 'strings', [jv('String', null)])).value, null);
    await assert.rejects(async () => invoke(main, 'strings', [jv('Object', {})]), /method\/native missing/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';

test('primitive-backed Strings retain their runtime type after widening to Object or passing through arrays', async () => {
  const lang = `package java.lang; class Object {} class Native extends Object {}
    interface Marker {} class String extends Native implements Marker {}`;
  const source = `package demo; import java.lang.String;
    class Main {
      int count(Object[] values) { int total = 0; for (int i = 0; i < values.length; i++) if (values[i] instanceof String) total++; return total; }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('java.lang.')
    ? { path: 'lang.java', source: lang } : className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('java.lang.String'); await jvm.loadClass('demo.Main');
  for (const value of [jv('String', 'text'), jv('Object', 'text'), jv('Object', '')]) {
    assert.equal(jvm.isInstance(value, 'java.lang.String'), true);
    assert.equal(jvm.isInstance(value, 'java.lang.Object'), true);
    assert.equal(jvm.isInstance(value, 'java.lang.Native'), true);
    assert.equal(jvm.isInstance(value, 'java.lang.Marker'), true);
  }
  for (const value of [jv('String', null), jv('Object', 7), jvm.construct('demo.Main', [])])
    assert.equal(jvm.isInstance(value, 'java.lang.String'), false);
  const main = jvm.construct('demo.Main', []), values = jv('Object[]', ['one', 7, null, 'two', '']);
  assert.equal(jvm.invoke(main, 'count', [values]).value, 3);
  assert.equal((await jvm.invokeAsync(main, 'count', [values])).value, 3);
});

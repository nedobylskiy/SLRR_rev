import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { StringNative } from '../src/runtime/string-native';

test('native String operations coexist with methods from the original Java source', async () => {
  const source = `package java.lang;
    class String {
      public native int length();
      public native String append(int code);
      public native String token(int index, String separators);
      public native int[] getASCII();
      public String chop(int count) {
        String text = this;
        while (count > 0) { text = text.append(8); count--; }
        return text;
      }
    }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'java.lang.String' ? { path: 'String.java', source } : null
  });
  new StringNative(jvm);
  await jvm.loadClass('java.lang.String');
  const value = jv('String', 'Hello');
  assert.equal(jvm.invoke(value, 'length').value, 5);
  assert.equal(jvm.invoke(value, 'chop', [jv('int', 2)]).value, 'Hel');
  assert.equal(jvm.invoke(value, 'append', [jv('int', 34)]).value, 'Hello"');
  assert.equal(jvm.invoke(jv('String', 'one two\tthree'), 'token', [jv('int', 1), jv('String', ' \t')]).value, 'two');
  assert.deepEqual(jvm.invoke(jv('String', 'AZ'), 'getASCII').value, [65, 90]);
});

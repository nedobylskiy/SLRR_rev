import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { StringNative } from '../src/runtime/string-native';
import { repairDecompiledSource } from '../src/runtime/source-repairs';

test('Garage numeric slider labels execute the Java printValue(String) body and retain format strings', async () => {
  const source = `package java.render.osd; import java.lang.Float;
    class Slider { float value; String vFmt; String text;
      void changeVLabelText(String text) { this.text = text; }
      void printValue(String format) { vFmt = format; changeVLabelText(Float.toString(value, vFmt)); }
      void update(float number) { printValue(number); }
    }`;
  const jvm = new SlrrJvm({ allowNumericStringArguments: true, resolveImport: ({ className }) =>
    className === 'java.render.osd.Slider' ? { path: 'Slider.java', source } : null });
  new StringNative(jvm); await jvm.loadClass('java.render.osd.Slider');
  const slider = await jvm.constructAsync('java.render.osd.Slider', []);
  jvm.set(slider, 'value', jv('float', 1.25));
  await jvm.invokeAsync(slider, 'update', [jv('float', -0.5)]);
  assert.equal(jvm.get(slider, 'text').value, '-0.5');
  assert.equal(jvm.get(slider, 'vFmt').value, '-0.5');
  assert.equal(jvm.get(slider, 'value').value, 1.25, 'printing a label does not move the slider');
  await jvm.invokeAsync(slider, 'printValue', [jv('String', '%.2fm')]);
  assert.equal(jvm.get(slider, 'text').value, '1.25m');
});

test('recovered getParams/trim preserve ROC tokens returned as Object values by a Vector', async () => {
  const source = `package java.lang; import java.util.Vector;
    class String {
      public native int length(); public native String token(int i, String separators);
      public static String getParams(Vector arg0) {
        String local1; int i = 0;
        while (i < arg0.size()) { if (arg0.elementAt(i) instanceof String) { local1 += arg0.elementAt(i); local1 += "\\t"; } i++; }
        return local1;
      }
      public Vector scanf() { Vector values = new Vector(); int i = 0; while (token(i, "\\t") != null) { values.addElement(token(i, "\\t")); i++; } return values; }
      public String trim(int arg0) {
        Vector local2 = scanf(); String local3; int i = 0;
        while (i < local2.size() - arg0) { local3 += local2.elementAt(i); local3 += "\\t"; i++; } return local3;
      }
      public String trim() { return trim(1); }
    }`;
  const vector = `package java.util; class Vector { Object[] data = new Object[8]; int count;
    void addElement(Object v) { data[count++] = v; } int size() { return count; } Object elementAt(int i) { return data[i]; } }`;
  const repaired = repairDecompiledSource('system/scripts/lang/decompiled/String.java', source);
  assert.equal(repairDecompiledSource('mods/src/String.java', source), source, 'mod sources are not rewritten');
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.lang.String'
    ? { path: 'String.java', source: repaired } : className === 'java.util.Vector' ? { path: 'Vector.java', source: vector } : null });
  new StringNative(jvm); await jvm.loadClass('java.lang.String'); await jvm.loadClass('java.util.Vector');
  const values = await jvm.constructAsync('java.util.Vector', []);
  for (const text of ['3', '1', '2', '0']) await jvm.invokeAsync(values, 'addElement', [jv('String', text)]);
  const params = await jvm.invokeAsync(jv('class', 'java.lang.String'), 'getParams', [values]);
  assert.equal(params.value, '3\t1\t2\t0\t');
  assert.equal((await jvm.invokeAsync(params, 'trim')).value, '3\t1\t2\t');
});

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

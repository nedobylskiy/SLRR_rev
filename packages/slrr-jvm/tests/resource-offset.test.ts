import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';

test('integer resource offsets preserve pack identity without turning arbitrary arithmetic into references', async () => {
  const source = `package demo; class Main {
    static final int BASE = frontend:0x9900r;
    int forward(int offset) { return BASE + offset; }
    int reverse(int offset) { return offset + BASE; }
    int backward(int offset) { return BASE - offset; }
    int scaled() { return BASE * 2; }
    int difference() { return BASE - BASE; }
    int increment() { int id = BASE; id++; id += 2; return id; }
  }`;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Main.java', source }), resolveResourceId: () => 0x3009900 });
  await jvm.loadClass('demo.Main'); const main = jvm.construct('demo.Main', []);
  for (const invoke of [jvm.invoke.bind(jvm), jvm.invokeAsync.bind(jvm)]) {
    for (const [method, offset, local] of [['forward', 17, 0x9911], ['reverse', 17, 0x9911], ['backward', 2, 0x98fe]] as const) {
      const value = await invoke(main, method, [jv('int', offset)]);
      assert.equal(value.value, 0x3000000 + local);
      assert.equal(value.resourceId, value.value);
      assert.deepEqual(value.resource, { pack: 'frontend', id: local });
    }
    assert.deepEqual((await invoke(main, 'increment', [])).resource, { pack: 'frontend', id: 0x9903 });
    for (const [method, args] of [['scaled', []], ['difference', []], ['forward', [jv('int', 0x10000)]], ['backward', [jv('int', 0x10000)]]] as const)
      assert.equal((await invoke(main, method, [...args])).resource, undefined);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm } from 'slrr-jvm';

for (const async of [false, true]) test(`virtual constructor callbacks retain subclass fields (${async ? 'async' : 'sync'})`, async () => {
  const source = `class Base {
    Base() { init(); }
    void init() {}
  }
  class Child extends Base {
    int count;
    int[] names;
    String osd;
    int observed;
    int explicit = 7;
    void init() { observed = count; count = 8; names = new int[8]; names[7] = 42; osd = "ready"; explicit = 3; }
    int read() { return names[count-1] + observed + explicit; }
    String hide() { return osd; }
  }`;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Child.java', source }) });
  await jvm.loadClass('Child');
  const instance = async ? await jvm.constructAsync('Child', []) : jvm.construct('Child', []);
  const read = async ? await jvm.invokeAsync(instance, 'read') : jvm.invoke(instance, 'read');
  assert.equal(read.value, 49, 'implicit defaults must not erase callback writes; explicit initializer still runs');
  const hide = async ? await jvm.invokeAsync(instance, 'hide') : jvm.invoke(instance, 'hide');
  assert.equal(hide.value, 'ready');
});


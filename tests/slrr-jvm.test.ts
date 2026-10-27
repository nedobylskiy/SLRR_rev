import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';

test('source package resolves Java imports through a host callback and dispatches a registered native', async () => {
  const sources = new Map([
    ['game/Main.java', `package game;
      import game.Helper;
      import game.HostMath;
      class Main {
        int offset;
        Main() { offset = 2; }
        int run(int n) { return Helper.twice(n) + HostMath.bump(offset); }
      }`],
    ['game/Helper.java', `package game;
      class Helper { static int twice(int n) { return n * 2; } }`]
  ]);
  const requests: string[] = [];
  const runtime = new SlrrJvm({
    resolveImport: ({ className, importedBy }) => {
      requests.push(`${className}:${importedBy ?? 'entry'}`);
      return className === 'game.HostMath' ? null : { path: `${className.replaceAll('.', '/')}.java` };
    },
    readSource: path => {
      const source = sources.get(path);
      if (!source) throw new Error(`Missing fixture ${path}`);
      return source;
    },
    selectMethods: name => name === 'game.Main' ? ['Main', 'run'] : ['twice']
  });
  runtime.natives.register('game.HostMath', 'bump', ['int'], ({ args }) => jv('int', Number(args[0].value) + 1));
  await Promise.all([runtime.loadClass('game.Main'), runtime.loadClass('game.Main')]);
  const main = runtime.construct('game.Main', []);
  assert.equal(runtime.invoke(main, 'run', [jv('int', 5)]).value, 13);
  assert.deepEqual(requests, ['game.Main:entry', 'game.Helper:game/Main.java', 'game.HostMath:game/Main.java']);
});

test('unresolved imports and unregistered native calls fail explicitly', async () => {
  const source = `package game; import game.Missing; class Main { int run() { return Missing.value(); } }`;
  const runtime = new SlrrJvm({
    resolveImport: ({ className }) => className === 'game.Main' ? { path: 'Main.java', source } : null,
    selectMethods: () => ['run']
  });
  await assert.rejects(runtime.loadClass('game.Main'), /Java import unresolved: game.Missing/);

  const native = new SlrrJvm({
    resolveImport: () => ({ path: 'Main.java', source: 'class Main { int run() { return missing(); } }' }),
    selectMethods: () => ['run']
  });
  await native.loadClass('Main');
  assert.throws(() => native.invoke(native.construct('Main', []), 'run'), /Java method\/native missing: Main.missing/);
});

test('separate resolvers select different Java versions without changing the runtime', async () => {
  const main = 'package game; import game.Config; class Main { int run() { return Config.version(); } }';
  const run = async (version: number) => {
    const jvm = new SlrrJvm({
      resolveImport: ({ className }) => className === 'game.Main'
        ? { path: 'game/Main.java', source: main }
        : { path: `mods/v${version}/Config.java`, source: `package game; class Config { static int version() { return ${version}; } }` },
      selectMethods: () => ['run', 'version']
    });
    await jvm.loadClass('game.Main');
    return jvm.invoke(jvm.construct('game.Main', []), 'run').value;
  };
  assert.equal(await run(1), 1);
  assert.equal(await run(2), 2);
});

test('static field failures retain the declaring class and source line', async () => {
  const source = `package game;
class Main {
  static Vector3 CENTER = new Vector3();
}`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'game.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('game.Main');
  assert.throws(() => jvm.get(jv('class', 'game.Main'), 'CENTER'),
    /Main\.<fields> \(source line 3\): Java constructor\/native missing: Vector3\(\)/);
});

test('an explicit super call reaches implicit java.lang.Object', async () => {
  const source = 'package java.lang; class Native { Native() { super(); } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.lang.Native' ? { path: 'Native.java', source } : null });
  await jvm.loadClass('java.lang.Native');
  assert.equal(jvm.construct('java.lang.Native', []).type, 'Native');
});

test('a resource literal exposes its type ID to source constructors', async () => {
  const source = 'package demo; class Main { int read() { ResourceRef ref = system:0x1br; return ref.typeID; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'read').value, 0x1b);
});

test('a resource literal assigned to an int retains its local resource ID', async () => {
  const source = 'package demo; class Main { static int RESOURCEID = system:0x32r; int read() { return RESOURCEID; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'read').value, 0x32);
});

test('a missing native implementation is distinguished from a missing Java method', async () => {
  const source = 'package demo; class Base { native void setFlags(int flags); } class Child extends Base { void run() { setFlags(1); } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => ['demo.Base', 'demo.Child'].includes(className) ? { path: 'Types.java', source } : null });
  await jvm.loadClass('demo.Child');
  assert.throws(() => jvm.invoke(jvm.construct('demo.Child', []), 'run'),
    /Java native implementation missing: demo\.Base\.setFlags\(int\)/);
});

test('null can match a reference parameter in a registered native', async () => {
  const source = 'package demo; import demo.Host; class Main { int run() { return Host.read(null); } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  jvm.natives.register('demo.Host', 'read', ['String'], () => jv('int', 7));
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 7);
});

test('a native reference parameter accepts an interpreted subclass instance', async () => {
  const source = `package demo;
class Base {}
class Child extends Base {}
class Host { static native int read(Base value); }
class Main { int run() { return Host.read(new Child()); } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Types.java', source } : null });
  jvm.natives.register('demo.Host', 'read', ['Base'], () => jv('int', 7));
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 7);
});

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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, parseSourceClass } from 'slrr-jvm';

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

test('async native suspends Java expressions and resumes with its resolved value', async () => {
  const source = `package demo; import demo.Remote;
    class Main {
      int base = Remote.read(2);
      Main() { base += Remote.read(1); }
      int run() { int sum = base; for (int i = 0; i < 2; i++) sum += Remote.read(i); return sum; }
    }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null,
    selectMethods: () => ['Main', 'run']
  });
  const calls: number[] = [];
  jvm.natives.registerAsync('demo.Remote', 'read', ['int'], async ({ args }) => {
    const value = Number(args[0].value);
    await Promise.resolve();
    calls.push(value);
    return jv('int', value + 10);
  });
  await jvm.loadClass('demo.Main');
  const main = await jvm.constructAsync('demo.Main', []);
  assert.equal((await jvm.invokeAsync(main, 'run')).value, 44);
  assert.deepEqual(calls, [2, 1, 0, 1]);
  assert.throws(() => jvm.invoke(main, 'run'), /Async Java native requires invokeAsync/);
});

test('concurrent Java threads waiting on natives do not exhaust the call-depth guard', async () => {
  const source = `package demo; import demo.Remote;
    class Main { int run() { Remote.pause(); return 7; } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null, maxDepth: 8 });
  const waiters: Array<() => void> = [];
  jvm.natives.registerAsync('demo.Remote', 'pause', [], () => new Promise(resolve => {
    waiters.push(() => resolve(jv('void', undefined)));
  }));
  await jvm.loadClass('demo.Main');
  const main = await jvm.constructAsync('demo.Main', []);
  const runs = Array.from({ length: 20 }, () => jvm.invokeAsync(main, 'run'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(waiters.length, 20);
  for (const resume of waiters) resume();
  assert.deepEqual((await Promise.all(runs)).map(result => result.value), Array(20).fill(7));
});

test('async native failure retains Java source location', async () => {
  const source = `package demo; import demo.Remote;
    class Main { int run() {
      return Remote.fail();
    } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null, selectMethods: () => ['run'] });
  jvm.natives.registerAsync('demo.Remote', 'fail', [], async () => { throw new Error('adapter offline'); });
  await jvm.loadClass('demo.Main');
  await assert.rejects(jvm.invokeAsync(await jvm.constructAsync('demo.Main', []), 'run'),
    /Main\.run \(source line 3\): adapter offline/);
});

test('a reference array preserves its element type when passed to a native method', async () => {
  const source = `package demo; import demo.Host;
    class Main { int run() { ResourceRef[] refs = new ResourceRef[1]; refs[0] = new ResourceRef(7); return Host.read(refs[0]); } }
    class ResourceRef { int id; ResourceRef(int value) { id = value; } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' || className === 'demo.ResourceRef'
    ? { path: 'Main.java', source } : null, selectMethods: () => ['Main', 'run', 'ResourceRef'] });
  jvm.natives.register('demo.Host', 'read', ['ResourceRef'], ({ args }) => jv('int', Number(jvm.get(args[0], 'id').value)));
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 7);
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

test('shared SLRR parser executes do/while, compound updates and qualified resource IDs', async () => {
  const source = `package demo;
    class Flow {
      int run() {
        int n = 0;
        do { n += 2; } while (n < 4);
        for (int i = 0; i < 2; i++, n += 1) { }
        return n;
      }
      ResourceRef id() {
        ResourceRef value = parts.engines.M20B25:0x05r;
        return value;
      }
    }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Flow' ? { path: 'Flow.java', source } : null,
    selectMethods: () => ['run', 'id']
  });
  await jvm.loadClass('demo.Flow');
  const instance = jvm.construct('demo.Flow', []);
  assert.equal(jvm.invoke(instance, 'run').value, 6);
  assert.deepEqual(jvm.invoke(instance, 'id').value, { pack: 'parts.engines.M20B25', id: 5 });
});

test('a source with several classes selects and executes the requested class', async () => {
  const source = `package demo;
    class Main { int enter() { return 1; } }
    class Gates { int show() { return 40 + 2; } }`;
  assert.equal(parseSourceClass(source, new Set(['show']), 'Gates').methods[0].name, 'show');
  const jvm = new SlrrJvm({
    resolveImport: () => ({ path: 'Main.java', source }),
    selectMethods: () => ['show']
  });
  await jvm.loadClass('demo.Gates');
  assert.equal(jvm.invoke(jvm.construct('demo.Gates', []), 'show').value, 42);
});

test('wildcard imports are resolved from classes actually referenced in source', async () => {
  const main = 'package demo; import demo.helpers.*; class Main { int run() { return Helper.twice(4); } }';
  const helper = 'package demo.helpers; class Helper { static int twice(int x) { return x * 2; } }';
  const requested: string[] = [];
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => {
      requested.push(className);
      if (className === 'demo.Main') return { path: 'Main.java', source: main };
      if (className === 'demo.helpers.Helper') return { path: 'Helper.java', source: helper };
      return null;
    },
    selectMethods: () => ['run', 'twice']
  });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 8);
  assert.ok(requested.includes('demo.helpers.Helper'));
});

test('source overloads choose the closest argument types', async () => {
  const source = `class Overloads {
    int pick(int x) { return 11; }
    int pick(float x) { return 22; }
    int run() { return pick(3) + pick(3.5); }
  }`;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Overloads.java', source }) });
  await jvm.loadClass('Overloads');
  assert.equal(jvm.invoke(jvm.construct('Overloads', []), 'run').value, 33);
});

test('a String returned through Object still matches a String parameter', async () => {
  const source = 'class Label { String text; void changeText(String value) { text = value; } }';
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Label.java', source }) });
  await jvm.loadClass('Label');
  const label = jvm.construct('Label', []);
  jvm.invoke(label, 'changeText', [jv('Object', '1600x900')]);
  assert.equal(jvm.get(label, 'text').value, '1600x900');
});

test('static fields initialize once and remain shared between instances', async () => {
  const source = `class Counter {
    static int count = 2;
    int next() { count += 1; return count; }
    static int current() { return count; }
  }`;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Counter.java', source }) });
  await jvm.loadClass('Counter');
  const first = jvm.construct('Counter', []), second = jvm.construct('Counter', []);
  assert.equal(jvm.invoke(first, 'next').value, 3);
  assert.equal(jvm.invoke(second, 'next').value, 4);
  assert.equal(jvm.invoke(jv('class', 'Counter'), 'current').value, 4);
});

test('super constructor executes source parent and can dispatch to a native parent', async () => {
  const source = `package demo;
    class Base { int value; Base(int x) { value = x; } }
    class Child extends Base { Child() { super(7); } int get() { return value; } int isBase() { return this instanceof Base; } }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Child' ? { path: 'Family.java', source } : null
  });
  await jvm.loadClass('demo.Child');
  const child = jvm.construct('demo.Child', []);
  assert.equal(jvm.invoke(child, 'get').value, 7);
  assert.equal(jvm.invoke(child, 'isBase').value, 1);

  let seen = 0;
  const nativeSource = 'package demo; import demo.NativeBase; class NativeChild extends NativeBase { NativeChild(int x) { super(x); } }';
  const nativeJvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.NativeChild' ? { path: 'NativeChild.java', source: nativeSource } : null
  });
  nativeJvm.natives.register('demo.NativeBase', '<init>', ['int'], ({ args }) => { seen = Number(args[0].value); return jv('void', undefined); });
  await nativeJvm.loadClass('demo.NativeChild');
  nativeJvm.construct('demo.NativeChild', [jv('int', 9)]);
  assert.equal(seen, 9);
});

test('child field initializers run after the parent constructor', async () => {
  const source = `package demo;
    class Base { int x = 1; Base() { x = 2; } }
    class Child extends Base {
      int y = x;
      Child() { super(); y += 1; }
      int value() { return y; }
    }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Child' ? { path: 'Family.java', source } : null
  });
  await jvm.loadClass('demo.Child');
  assert.equal(jvm.invoke(jvm.construct('demo.Child', []), 'value').value, 3);
});

test('SLRR constructors can pass a literal instance field to super', async () => {
  const source = `package demo;
    class Base { String title; Base(String value) { title = value; } }
    class Child extends Base {
      String defTitle = "OPTIONS";
      Child() { super(defTitle); }
      String getTitle() { return title; }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Child'
    ? { path: 'Child.java', source } : null });
  await jvm.loadClass('demo.Child');
  assert.equal(jvm.invoke(jvm.construct('demo.Child', []), 'getTitle').value, 'OPTIONS');
  assert.equal((await jvm.invokeAsync(await jvm.constructAsync('demo.Child', []), 'getTitle')).value, 'OPTIONS');
});

test('this constructor chaining initializes instance fields once', async () => {
  const source = `class Chain {
    int x = 1;
    Chain() { this(3); x += 1; }
    Chain(int n) { x = n; }
    int get() { return x; }
  }`;
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'Chain.java', source }) });
  await jvm.loadClass('Chain');
  assert.equal(jvm.invoke(jvm.construct('Chain', []), 'get').value, 4);
});

test('new on a host-native class uses its registered constructor and instance methods', async () => {
  const source = 'package demo; import demo.Host; class Main { int run() { return new Host(5).twice(); } }';
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null
  });
  jvm.natives.register('demo.Host', '<init>', ['int'], ({ args }) => jv('demo.Host', { x: Number(args[0].value) }));
  jvm.natives.register('demo.Host', 'twice', [], ({ receiver }) => jv('int', Number((receiver.value as { x: number }).x) * 2));
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 10);
});

test('java.lang native parents and fields resolve implicitly, and arrays expose length', async () => {
  const source = `package demo; class Child extends NativeBase {
    Child() { ping(); }
    int read() { int[] values = new int[3]; return Host.VALUE + values.length; }
  }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Child' ? { path: 'Child.java', source } : null,
  });
  let pinged = false;
  jvm.natives.register('java.lang.NativeBase', '<init>', [], () => jv('void', undefined));
  jvm.natives.register('java.lang.NativeBase', 'ping', [], () => { pinged = true; return jv('void', undefined); });
  jvm.natives.registerField('java.lang.Host', 'VALUE', jv('int', 2));
  await jvm.loadClass('demo.Child');
  const child = jvm.construct('demo.Child', []);
  assert.equal(pinged, true);
  assert.equal(jvm.invoke(child, 'read').value, 5);
  jvm.set(jv('class', 'java.lang.Host'), 'VALUE', jv('int', 4));
  assert.equal(jvm.invoke(child, 'read').value, 7);
});

test('a sibling class in the same source file runs its constructor', async () => {
  const source = `package demo; class Main {
    int read() { Goal goal = new Goal(7); return goal.flag; }
  } class Goal { int flag; Goal(int value) { flag = value; } }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null,
    selectMethods: className => className === 'demo.Main' ? ['read'] : [className.split('.').at(-1)!],
  });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'read').value, 7);
});

test('runtime errors identify the failing expression line', async () => {
  const source = `package demo;
class Main {
  void run() {
    missing();
  }
}`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.throws(() => jvm.invoke(jvm.construct('demo.Main', []), 'run'), /Main\.run \(source line 4\): Java method\/native missing: demo\.Main\.missing/);
});

test('a referenced class resolves from the current package without an import', async () => {
  const sources = new Map([
    ['demo/Main.java', 'package demo; class Main { int run() { return City.VALUE; } }'],
    ['demo/City.java', 'package demo; class City { static int VALUE = 17; }'],
  ]);
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => {
      const path = `${className.replaceAll('.', '/')}.java`;
      return sources.has(path) ? { path, source: sources.get(path) } : null;
    },
  });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 17);
});

test('an async call resolves a same-package class referenced by a deferred method', async () => {
  const sources = new Map([
    ['demo/Main.java', 'package demo; class Main { Main() {} int run() { return Bot.VALUE; } }'],
    ['demo/Bot.java', 'package demo; class Bot { static int VALUE = 17; }'],
  ]);
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => {
      const path = `${className.replaceAll('.', '/')}.java`;
      return sources.has(path) ? { path, source: sources.get(path) } : null;
    },
    selectMethods: className => className === 'demo.Main' ? ['Main'] : undefined,
  });
  await jvm.loadClass('demo.Main');
  const main = jvm.construct('demo.Main', []);
  assert.equal((await jvm.invokeAsync(main, 'run')).value, 17);
});

test('a lowercase sibling class used by a static field is loaded from the same source', async () => {
  const source = 'package demo; class Main { static database db = new database(); static int run() { return db.value; } } class database { int value = 23; }';
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => ['demo.Main', 'demo.database'].includes(className)
      ? { path: 'demo/Main.java', source } : null,
    selectMethods: className => className === 'demo.Main' ? ['Main'] : undefined,
  });
  await jvm.loadClass('demo.Main');
  assert.equal((await jvm.invokeAsync(jv('class', 'demo.Main'), 'run')).value, 23);
});

test('a source constructor accepts an object implementing its interface', async () => {
  const source = `package demo;
    interface Runnable { void run(); }
    class Target implements Runnable { void run() {} }
    class Thread { Runnable target; Thread(Runnable value) { target = value; } }
    class Main { static Thread create() { return new Thread(new Target()); } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'demo/Types.java', source } : null });
  await jvm.loadClass('demo.Main');
  const thread = await jvm.invokeAsync(jv('class', 'demo.Main'), 'create');
  assert.equal(jvm.isInstance(jvm.get(thread, 'target'), 'demo.Runnable'), true);
});

test('static field failures identify the declaring class and source line', async () => {
  const source = `package demo;
class Main {
  static Vector3 CENTER = new Vector3();
}`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.throws(() => jvm.get(jv('class', 'demo.Main'), 'CENTER'),
    /Main\.<fields> \(source line 3\): Java constructor\/native missing: Vector3\(\)/);
});

test('an explicit super call reaches implicit java.lang.Object', async () => {
  const source = 'package java.lang; class Native { Native() { super(); } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.lang.Native' ? { path: 'Native.java', source } : null });
  await jvm.loadClass('java.lang.Native');
  assert.equal(jvm.construct('java.lang.Native', []).type, 'Native');
});

test('a decompiled super call can select a grandparent constructor', async () => {
  const source = `package demo;
    class Base { int value; Base(int left, int right) { value = left + right; } }
    class Middle extends Base { int marker = 9; Middle(int value) { super(value, 1); } }
    class Child extends Middle { Child() { super(2, 3); } }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Types.java', source } : null });
  await jvm.loadClass('demo.Child');
  const child = await jvm.constructAsync('demo.Child', []);
  assert.equal(jvm.get(child, 'value').value, 5);
  assert.equal(jvm.get(child, 'marker').value, 9);
});

test('a resource literal exposes its type ID to source constructors', async () => {
  const source = 'package demo; class Main { int read() { ResourceRef ref = system:0x1br; return ref.typeID; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'read').value, 0x1b);
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

test('a resource literal assigned to an int retains its local resource ID', async () => {
  const source = 'package demo; class Main { static int RESOURCEID = system:0x32r; int read() { return RESOURCEID; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main' ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'read').value, 0x32);
});

test('a resource ID retains its pack through int fields and method arguments', async () => {
  const source = `package demo;
    class Main {
      int track = maps.Norisring.t_data:0x102r;
      int run() { return Host.inspect(track); }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null });
  jvm.natives.register('demo.Host', 'inspect', ['int'], ({ args }) => {
    assert.deepEqual(args[0].resource, { pack: 'maps.Norisring.t_data', id: 0x102 });
    return jv('int', Number(args[0].value));
  });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 0x102);
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

test('a class without constructors forwards constructor arguments to its parent', async () => {
  const source = 'package demo; class Base { int value; Base(int n) { value = n; } } class Child extends Base { int extra = 4; }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Types.java', source } : null });
  await jvm.loadClass('demo.Child');
  const child = jvm.construct('demo.Child', [jv('int', 27)]);
  assert.equal(jvm.get(child, 'value').value, 27);
  assert.equal(jvm.get(child, 'extra').value, 4);
});

test('the SLRR dialect permits an implicit no-argument constructor beside declared overloads', async () => {
  const source = 'package demo; class Base { int marker = 3; } class Child extends Base { Child(int n) { marker = n; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Types.java', source } : null });
  await jvm.loadClass('demo.Child');
  assert.equal(jvm.get(jvm.construct('demo.Child', []), 'marker').value, 3);
});

test('a source method outside the eager method set is parsed when called', async () => {
  const source = 'package demo; class Main { int value; Main() { update(12); } void update(int n) { value = n; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null, selectMethods: () => ['Main'] });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.get(jvm.construct('demo.Main', []), 'value').value, 12);
});

test('a deferred source method can construct a sibling class from the same Java file', async () => {
  const source = `package demo;
    class Main { Main() {} int open() { Dialog dialog = new Dialog(); return dialog.value; } }
    class Dialog { int value = 42; Dialog() {} }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Main.java', source } : null,
    selectMethods: className => className === 'demo.Main' ? ['Main'] : undefined });
  await jvm.loadClass('demo.Main');
  const main = await jvm.constructAsync('demo.Main', []);
  assert.equal((await jvm.invokeAsync(main, 'open')).value, 42);
});

test('a resource literal matches an integer constructor argument', async () => {
  const source = 'package demo; class Ref { int id; Ref(int value) { id = value; } } class Main { int read() { return new Ref(frontend:0xd7r).id; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Types.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'read').value, 0xd7);
});

test('numeric literals narrow to int while variables retain their declared type', async () => {
  const source = `package demo;
    class Counter { int value; Counter(int n) { value = n; } }
    class Main {
      int asConstructor() { return new Counter(0.5).value + new Counter(-2.9).value; }
      int asMethod(int n) { return n; }
      int choose(int n) { return 1; }
      int choose(float n) { return 2; }
      int direct() { return asMethod(8.0) + choose(8.0); }
      int variable() { float n = 8.0; return new Counter(n).value; }
    }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className.startsWith('demo.')
    ? { path: 'Numeric.java', source } : null });
  await jvm.loadClass('demo.Main');
  const main = jvm.construct('demo.Main', []);
  assert.equal(jvm.invoke(main, 'asConstructor').value, -2);
  assert.equal(jvm.invoke(main, 'direct').value, 10);
  assert.throws(() => jvm.invoke(main, 'variable'), /Java constructor missing: demo.Counter\(1\)/);
});

test('SLRR numeric narrowing permits a float variable to call an int-only method', async () => {
  const source = `package demo; class Main {
    int take(int value) { return value; }
    int run() { float value = 1.9; return take(value); }
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null, allowNumericNarrowing: true });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'run').value, 1);
});

test('a host-resolved resource literal becomes the packed integer in an int array', async () => {
  const source = `package demo; class Palette {
    static int[] colors = new int[1];
    Palette() { colors[0] = cars:0x2Ar; }
    int color() { return colors[0]; }
  }`;
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'demo.Palette' ? { path: 'demo/Palette.java', source } : null,
    resolveResourceId: (resource, path) => path === 'demo/Palette.java' && resource.pack === 'cars'
      ? (3 << 16) | resource.id : undefined,
  });
  await jvm.loadClass('demo.Palette');
  assert.equal(jvm.invoke(jvm.construct('demo.Palette', []), 'color').value, 196650);
});

test('a resource ID keeps its pack identity when passed through an int array', async () => {
  const source = `package demo; class Main {
    int[] parts = new int[1];
    Main() { parts[0] = cars.racers.Sample:0xEEr; }
    int part() { return parts[0]; }
  }`;
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null,
    resolveResourceId: () => 0xee });
  await jvm.loadClass('demo.Main');
  const value = jvm.invoke(jvm.construct('demo.Main', []), 'part');
  assert.equal(value.value, 0xee);
  assert.deepEqual(value.resource, { pack: 'cars.racers.Sample', id: 0xee });
});

test('a modded source with duplicate signatures uses its last declaration', async () => {
  const source = 'package demo; class Main { int value() { return 1; } int value() { return 2; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Main'
    ? { path: 'Main.java', source } : null });
  await jvm.loadClass('demo.Main');
  assert.equal(jvm.invoke(jvm.construct('demo.Main', []), 'value').value, 2);
});

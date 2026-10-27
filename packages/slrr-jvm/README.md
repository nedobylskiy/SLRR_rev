# SLRR-JVM

**SLRR-JVM interprets original Street Legal Racing: Redline `.java` source files. It does not execute `.class` bytecode.** In particular, the game's TUFA `.class` format is outside this package. No conversion from `.class` to JavaScript or standard JVM bytecode takes place.

This is an early TypeScript runtime for the Java dialect found in SLRR scripts. It uses the source parser from [SLRR-JVM-compiler](https://github.com/nedobylskiy/SLRR-JVM-compiler), then executes the parsed source AST with a step budget and explicit host capabilities. The project is being developed separately from the game-specific renderer, physics, menu, and asset loaders in [SLRR_rev](https://github.com/nedobylskiy/SLRR_rev).

## Try it

```sh
git clone https://github.com/nedobylskiy/SLRR-JVM.git
cd SLRR-JVM
npm ci
npm test
npm run example
```

The example prints `13`. It loads the included synthetic [`Main.java`](examples/java/Main.java), resolves its [`Helper.java`](examples/java/Helper.java) import, and runs a host-registered native function. The example files are small fixtures; **original SLRR game files are not distributed here**. Supply `.java` files from your own installation through the same callbacks.

To execute a class from a real game source, pass your installed `MainMenu.java` to the ColorBank example:

```sh
npm run example:game -- "C:/path/to/Street Legal Racing Redline/sl/Scripts/game/src/MainMenu.java"
```

This loads the `ColorBank` class from that multi-class source, runs its constructor and `getColor()` method, and prints four colors. It reads the `.java` file directly; no `.class` is involved.

## Embedding API

```ts
import { readFile } from 'node:fs/promises';
import { SlrrJvm, jv } from 'slrr-jvm';

const files = new Map([
  ['demo.Main', 'examples/java/Main.java'],
  ['demo.Helper', 'examples/java/Helper.java']
]);
const jvm = new SlrrJvm({
  // Decide where each imported Java class lives. This can consult a mod index,
  // load order, game version, or the path of the importing file.
  resolveImport: ({ className, importedBy }) => {
    if (className === 'demo.HostMath') return null; // Host-native class.
    const path = files.get(className);
    return path ? { path } : null;
  },
  readSource: path => readFile(path, 'utf8'),
  // Optional: omit to expose every method in the source file.
  selectMethods: className => className === 'demo.Main' ? ['run'] : ['twice'],
  floatMode: 'B' // Build 940 float-literal conversion
});

jvm.natives.register('demo.HostMath', 'offset', [], () => jv('int', 3));

await jvm.loadClass('demo.Main');
const main = jvm.construct('demo.Main', []);
const result = jvm.invoke(main, 'run', [jv('int', 5)]);
console.log(result.value); // 13
```

[`examples/basic.ts`](examples/basic.ts) contains a runnable Node.js version of this example. `resolveImport` receives the fully qualified Java class name and optional `importedBy` path. It returns `{ path }`, optionally with `{ source }`, or `null` when that candidate has no source. `readSource` is only needed when the resolver does not supply source text. Explicit imports and classes referenced through wildcard imports are loaded before method execution, so execution itself is synchronous. A separate `SlrrJvm` instance can use a different resolver to run sources from another game version or mod.

Native methods are **opt-in** host callbacks registered by class, method, and exact argument types. The game session owns these bindings and registers them before loading source classes that import native classes. The interpreter exposes no ambient filesystem, DOM, network, or SLRR engine APIs. Missing imports and native calls raise errors rather than silently succeeding.

For host capabilities that return a Promise (for example, a file or network adapter), use the async execution path:

```ts
jvm.natives.registerAsync('demo.Files', 'readNumber', ['String'], async ({ args }) => {
  const response = await fetch(`/api/value?name=${encodeURIComponent(String(args[0].value))}`);
  return jv('int', Number(await response.text()));
});

await jvm.loadClass('demo.Main');
const main = await jvm.constructAsync('demo.Main', []);
const result = await jvm.invokeAsync(main, 'run');
```

Java execution waits for each Promise before evaluating the next expression. Synchronous registrations also work through `constructAsync` and `invokeAsync`. Existing `construct` and `invoke` remain synchronous and fail explicitly if they encounter a native registered with `registerAsync`. Execute one Java call at a time on a JVM instance while using the async path; concurrent execution contexts are not isolated yet.

Host-native objects can be created from Java `new` expressions by registering a method named `<init>` for that class. The constructor callback returns a `JavaValue`; subsequent calls on that value dispatch to other registered methods of the same class.

## Current limits

- The shared parser accepts the 3,453 `.java` files currently visible in one Build 940 installation (the original `MainMenu.java` is temporarily renamed for a separate compiler runtime test). It yields 3,499 classes and 5,952 method bodies. Parsing does not imply every method can execute with the current host bindings.
- A local execution check ran the original `ColorBank` class inside `MainMenu.java` and reproduced its color values at indices 0, 1, 23, and 37. This is a narrow runtime check, separate from the compiler's original-VM test.
- Explicit and wildcard imports use the callback. Wildcard candidates are inferred from source references; a resolver must return `null` for candidates it cannot supply. Static imports are not supported.
- The interpreter supports source constructors, `super(...)`, `this(...)`, native constructors, static field initialization, common overloads, short-circuit expressions, `switch`, `do/while`, `for`, and resource literals. Full Java overload resolution, some class initialization edge cases, a standard library, and threads remain incomplete. The game session supplies its own SLRR native API bindings; unbound native calls fail explicitly.
- The runtime is **source-only**. TUFA `.class` parsing and bytecode execution are not part of this package.

`npm run build` produces ESM JavaScript and TypeScript declarations in `dist/`. `npm pack --dry-run` shows the files included in a package archive. The package has not been published to the npm registry.

# SLRR-JVM

A small TypeScript interpreter for the Java source dialect used by Street Legal Racing: Redline. It parses selected method bodies from `.java` files and executes them against explicit host capabilities. It does **not** load TUFA `.class` files, use a standard JVM, or provide the full Java language or SLRR native API yet.

The package has no filesystem, browser, or game-engine dependency. The embedding application decides where a class lives and how its source is read:

```ts
import { readFile } from 'node:fs/promises';
import { SlrrJvm, jv } from 'slrr-jvm';

const jvm = new SlrrJvm({
  resolveImport: ({ className, importedBy }) => {
    // This callback may use an index, mod load order, or the importing file.
    // Returning null is allowed for a class implemented by registered natives.
    if (className === 'game.HostMath') return null;
    return { path: `/game/Scripts/${className.replaceAll('.', '/')}.java` };
  },
  readSource: path => readFile(path, 'utf8'),
  selectMethods: className => className === 'game.Main' ? ['Main', 'run'] : []
});

jvm.natives.register('game.HostMath', 'double', ['int'], ({ args }) =>
  jv('int', Number(args[0].value) * 2));

await jvm.loadClass('game.Main'); // loads explicit imports before execution
const main = jvm.construct('game.Main', []);
const result = jvm.invoke(main, 'run', [jv('int', 5)]);
```

`resolveImport` receives the fully qualified class name and the path of the importing file, if any. It returns a path and can optionally return the source text directly. When it returns only a path, `readSource` supplies the text. The resolver owns mod/version precedence and path lookup; the interpreter never guesses an installation path. Register host-native methods with a class name, method name, and parameter types. Missing imports, unsupported syntax, and unregistered native calls fail explicitly.

Only named methods are parsed because some original files contain dialect constructs outside the currently supported subset. This is a source interpreter, not a complete JVM. The current implementation supports the expression and control-flow subset used by the extracted menu and Part serialization adapters. Explicit imports are preloaded so method execution remains synchronous. Wildcard and static imports, full Java overload resolution, arbitrary standard-library classes, threads, and bytecode execution are not implemented.

In this repository, the menu and Part adapters import `slrr-jvm`; their game-specific native behavior stays outside the package. Build it with `npm run build:jvm` from the repository root, or run `npm run build` in this directory after installing its dependencies. The distributable JavaScript and type declarations are emitted to `dist/`.

import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { decompileClass, parseTufa } from 'slrr-jvm-decompiler';
import { Assets } from '../assets';
import { GameTypeNative } from './game-type-native';
import { MathNative } from './math-native';

export type BootEvent = { level: 'info' | 'native' | 'error'; message: string };
export type BootResult = { jvm: SlrrJvm; gameTypes: GameTypeNative; error?: Error };

const sourceRoot = 'sl/scripts/game/src/';
const systemRoot = 'system/scripts/';
const voidValue = () => jv('void', undefined);

function sourceDiagnostic(message: string, sources: Map<string, string>, assets: Assets): string {
  const frames = [...message.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*|<fields>) \(source line (\d+)\)/g)];
  const frame = frames.at(-1);
  if (!frame) return message;
  const [, className, , lineText] = frame, line = Number(lineText);
  const preferred = `${sourceRoot}${className}.java`.toLowerCase();
  const found = sources.has(preferred)
    ? preferred
    : [...sources.keys()].find(path => new RegExp(`\\bclass\\s+${className}\\b`).test(sources.get(path)!));
  if (!found) return message;
  const code = sources.get(found)!.split(/\r?\n/)[line - 1]?.trim();
  if (!code) return message;
  const path = assets.byPath.get(found)?.path ?? found;
  return `${message}\n${path}:${line}\n> ${code}`;
}

/** Starts the game's original Java source. Every host capability is explicitly registered. */
export async function bootGame(assets: Assets, report: (event: BootEvent) => void): Promise<BootResult> {
  const sources = new Map<string, string>();
  const jvm = new SlrrJvm({
    resolveImport: async ({ className }) => {
      if (/^java\.game\.[^.]+$/.test(className)) {
        const path = `${sourceRoot}${className.split('.').at(-1)}.java`;
        if (assets.byPath.has(path.toLowerCase())) return { path };
      }
      if (!/^java\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(className)) return null;
      const path = `${systemRoot}${className.slice('java.'.length).replaceAll('.', '/')}.class`;
      const sourcePath = path.replace(/\/([^/]+)\.class$/i, '/src/$1.java');
      if (assets.byPath.has(sourcePath.toLowerCase())) return { path: sourcePath };
      if (!assets.byPath.has(path.toLowerCase())) return null;
      const classes = parseTufa(await assets.read(path));
      const cls = classes.find(entry => entry.name === className);
      if (!cls) throw new Error(`TUFA class missing in ${path}: ${className}`);
      const result = decompileClass(cls);
      if (result.diagnostics.length) throw new Error(`TUFA decompilation failed for ${path}: ${result.diagnostics.join('; ')}`);
      sources.set(path.toLowerCase(), result.source);
      return { path, source: result.source };
    },
    readSource: async path => {
      const source = new TextDecoder().decode(await assets.read(path));
      sources.set(path.toLowerCase(), source);
      return source;
    },
    selectMethods: className => [className.split('.').at(-1)!],
  });

  const native = (owner: string, method: string, signature: string[], effect?: (args: readonly JavaValue[]) => void) => {
    jvm.natives.register(owner, method, signature, ({ args }) => {
      report({ level: 'native', message: `Host stub: ${owner}.${method}(${signature.join(', ')})` });
      effect?.(args);
      return voidValue();
    });
  };
  const gameTypes = new GameTypeNative(jvm, report);
  new MathNative(jvm);
  const collector = 'java.lang.GarbageCollector';
  jvm.natives.register(collector, '<init>', [], () => {
    report({ level: 'native', message: 'Host stub: java.lang.GarbageCollector.<init>()' });
    return jv('GarbageCollector', {});
  });
  native(collector, 'push', ['Object']);
  native(collector, 'flush', []);
  native('java.util.resource.ResourceRef', 'newNative', []);
  native('java.util.resource.ResourceRef', 'set', ['int']);
  native('java.util.resource.ResourceRef', 'set', ['ResourceRef']);
  native('java.util.resource.ResourceRef', 'precache', []);
  native('java.util.resource.ResourceRef', 'cache', []);
  const controller = 'java.io.Controller';
  jvm.natives.registerField(controller, 'controlFile', jv('String', ''));
  native('java.game.Frontend', 'init', []);
  native('java.game.LoadingScreen', 'show', ['ResourceRef', 'int']);
  native('java.sound.Sound', 'init', []);
  native('java.io.Input', 'initControllers', ['Init', 'String'], args => {
    jvm.natives.setField(controller, 'controlFile', args[1]);
  });
  native('java.io.Input', 'enablePointingDevice', []);
  jvm.natives.registerField('java.game.Frontend', 'loadingScreen', jv('LoadingScreen', {}));
  // The original Frontend values are engine-owned. These placeholders only identify precache requests.
  for (const name of ['SFX_MENU_MOVE', 'SFX_MENU_SELECT', 'SFX_QUESTION'])
    jvm.natives.registerField('java.game.Frontend', name, jv('int', 0));
  jvm.natives.registerField('java.game.Config', 'restart_apply', jv('int', 0));

  const entry = `${sourceRoot}Init.java`;
  report({ level: 'info', message: `Entry: ${entry} → new Init(0)` });
  try {
    await jvm.loadClass('java.game.Init');
    jvm.construct('java.game.Init', [jv('int', 0)]);
    report({ level: 'info', message: 'Init.java completed' });
    return { jvm, gameTypes };
  } catch (reason) {
    const original = reason instanceof Error ? reason : new Error(String(reason));
    const error = new Error(sourceDiagnostic(original.message, sources, assets), { cause: original });
    report({ level: 'error', message: error.message });
    return { jvm, gameTypes, error };
  }
}

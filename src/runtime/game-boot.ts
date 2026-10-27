import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { decompileClass, parseTufa } from 'slrr-jvm-decompiler';
import { Assets, normalizePath } from '../assets';
import { GameTypeNative } from './game-type-native';
import { MathNative } from './math-native';
import { ViewportNative, type ViewportSize } from './viewport-native';
import { CameraNative } from './camera-native';
import { ControllerNative } from './controller-native';
import { InputNative } from './input-native';
import { FileNative } from './file-native';
import { AssetCatalogAdapter, FindFileNative } from './find-file-native';
import { ResourceCatalog } from './resource-catalog';
import { StringNative } from './string-native';
import { SystemNative } from './system-native';
import { PartNative } from './part-native';
import { browserKeyValue, type KeyValue } from './key-value';
import { VirtualFileSystem } from './virtual-file-system';
import { RenderRefNative } from './render-ref-native';
import type { RenderObject } from './render-object';

export type BootEvent = { level: 'info' | 'native' | 'error'; message: string };
export type BootResult = { jvm: SlrrJvm; gameTypes: GameTypeNative; viewports: ViewportNative; renderRefs: RenderRefNative; cameras: CameraNative; input: InputNative; files: VirtualFileSystem; error?: Error };

const sourceRoot = 'sl/scripts/game/src/';
const systemRoot = 'system/scripts/';
const voidValue = () => jv('void', undefined);

function sourceDiagnostic(message: string, sources: Map<string, string>, assets: Assets): string {
  const native = /Java native implementation missing: ([\w.]+)\.([\w$]+)\(/.exec(message);
  const nativeClass = native?.[1].split('.').at(-1);
  const declaration = native && [...sources].find(([path]) => path.endsWith(`/src/${nativeClass}.java`.toLowerCase())
    || path.endsWith(`/${nativeClass}.class`.toLowerCase()));
  const nativeLine = declaration?.[1].split(/\r?\n/).findIndex(line => new RegExp(`\\bnative\\b.*\\b${native![2]}\\s*\\(`).test(line));
  const nativeDetail = declaration && nativeLine !== undefined && nativeLine >= 0
    ? `\nNative declaration: ${assets.byPath.get(declaration[0])?.path ?? declaration[0]}:${nativeLine + 1}\n> ${declaration[1].split(/\r?\n/)[nativeLine].trim()}` : '';
  const frames = [...message.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*|<fields>) \(source line (\d+)\)/g)];
  const frame = frames.at(-1);
  if (!frame) return message + nativeDetail;
  const [, className, , lineText] = frame, line = Number(lineText);
  const preferred = `${sourceRoot}${className}.java`.toLowerCase();
  const found = sources.has(preferred)
    ? preferred
    : [...sources.keys()].find(path => new RegExp(`\\bclass\\s+${className}\\b`).test(sources.get(path)!));
  if (!found) return message + nativeDetail;
  const code = sources.get(found)!.split(/\r?\n/)[line - 1]?.trim();
  if (!code) return message + nativeDetail;
  const path = assets.byPath.get(found)?.path ?? found;
  return `${message}\n${path}:${line}\n> ${code}${nativeDetail}`;
}

/** Starts the game's original Java source. Every host capability is explicitly registered. */
export async function bootGame(assets: Assets, report: (event: BootEvent) => void,
  viewportSize: () => ViewportSize = () => ({ width: 1, height: 1 }),
  renderChanged?: (node: RenderObject) => void,
  keyValue: KeyValue = browserKeyValue()): Promise<BootResult> {
  const files = await VirtualFileSystem.load(keyValue);
  for (const asset of assets.files) {
    files.indexOriginalPath(asset.path);
    if (!/^save\/controls\/[^/]+$/i.test(asset.path.replaceAll('\\', '/'))) continue;
    files.mountOriginal(asset.path, await assets.read(asset.path));
  }
  const sources = new Map<string, string>();
  const dynamicSources = new Map<string, { path: string; source: string }>();
  const carScripts = new Map<string, string>();
  const javaSourcesByName = new Map<string, string[]>();
  for (const asset of assets.files) {
    const path = normalizePath(asset.path);
    if (path.endsWith('.java')) {
      const name = path.split('/').at(-1)!;
      const matches = javaSourcesByName.get(name) ?? [];
      matches.push(asset.path);
      javaSourcesByName.set(name, matches);
    }
    const match = /^cars\/.+\/scripts\/src\/([a-z_$][\w$]*)\.java$/i.exec(path);
    if (match) carScripts.set(`java.game.cars.${match[1]}`.toLowerCase(), asset.path);
  }
  const jvm = new SlrrJvm({
    resolveImport: async ({ className }) => {
      const dynamicSource = dynamicSources.get(className);
      if (dynamicSource) return dynamicSource;
      const carScript = carScripts.get(className.toLowerCase());
      if (carScript) return { path: carScript };
      if (/^java\.game\.[^.]+$/.test(className)) {
        const path = `${sourceRoot}${className.split('.').at(-1)}.java`;
        if (assets.byPath.has(path.toLowerCase())) return { path };
      }
      if (!/^java\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(className)) return null;
      const path = `${systemRoot}${className.slice('java.'.length).replaceAll('.', '/')}.class`;
      const sourcePath = path.replace(/\/([^/]+)\.class$/i, '/src/$1.java');
      if (assets.byPath.has(sourcePath.toLowerCase())) return { path: sourcePath };
      const simpleName = className.split('.').at(-1)!;
      for (const candidate of javaSourcesByName.get(`${simpleName.toLowerCase()}.java`) ?? []) {
        const candidatePath = normalizePath(candidate);
        const source = sources.get(candidatePath) ?? new TextDecoder().decode(await assets.read(candidate));
        if (!new RegExp(`\\bpackage\\s+${className.slice(0, -simpleName.length - 1).replaceAll('.', '\\.')}\\s*;`).test(source)) continue;
        sources.set(candidatePath, source);
        return { path: candidate, source };
      }
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
    selectMethods: className => className.startsWith('java.game.') ? [className.split('.').at(-1)!] : undefined,
  });

  const native = (owner: string, method: string, signature: string[], effect?: (args: readonly JavaValue[]) => void) => {
    jvm.natives.register(owner, method, signature, ({ args }) => {
      report({ level: 'native', message: `Host stub: ${owner}.${method}(${signature.join(', ')})` });
      effect?.(args);
      return voidValue();
    });
  };
  new StringNative(jvm);
  new SystemNative(jvm, report);
  new PartNative(jvm);
  const resourceCatalog = new ResourceCatalog(await Promise.all(['system.rpk', 'cars.rpk']
    .filter(path => assets.byPath.has(normalizePath(path)))
    .map(async path => [path, await assets.pack(path)] as const)));
  const gameTypes = new GameTypeNative(jvm, report, renderChanged, resourceCatalog,
    async (script, typeId) => {
      const compiled = normalizePath(script);
      const sourcePath = compiled.replace(/\/([^/]+)\.class$/i, '/src/$1.java');
      const source = assets.byPath.get(sourcePath);
      if (!source) throw new Error(`Resource Java source missing: ${sourcePath}`);
      let content = new TextDecoder().decode(await assets.read(source.path));
      const packageName = /\bpackage\s+([\w.]+)\s*;/.exec(content)?.[1];
      if (!packageName) throw new Error(`Resource Java package missing: ${source.path}`);
      let simpleName = source.path.replaceAll('\\', '/').split('/').at(-1)!.replace(/\.java$/i, '');
      let className = `${packageName}.${simpleName}`;
      if (dynamicSources.has(className) && normalizePath(dynamicSources.get(className)!.path) !== normalizePath(source.path)) {
        // Resource packs may declare the same Java class name (for example, every map has track_data).
        // Give the host-loaded copy a unique identity while keeping its Java method bodies intact.
        const originalName = simpleName;
        const path = normalizePath(source.path);
        let hash = 2166136261;
        for (let i = 0; i < path.length; i++) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619);
        simpleName = `${originalName}_${(hash >>> 0).toString(16)}`;
        const declaration = new RegExp(`\\bclass\\s+${originalName}\\b`);
        if (!declaration.test(content)) throw new Error(`Resource Java class missing: ${source.path}`);
        content = content.replace(declaration, `class ${simpleName}`)
          .replace(new RegExp(`\\b${originalName}(?=\\s*\\()`, 'g'), simpleName);
        className = `${packageName}.${simpleName}`;
      }
      dynamicSources.set(className, { path: source.path, source: content });
      sources.set(normalizePath(source.path), content);
      await jvm.loadClass(className);
      const constructors = [...content.matchAll(new RegExp(`\\b${simpleName}\\s*\\(([^)]*)\\)`, 'g'))];
      const takesId = constructors.some(match => /^\s*int\s+\w+\s*$/.test(match[1]));
      return jvm.constructAsync(className, takesId ? [jv('int', typeId)] : []);
    }, async pack => {
      const path = pack.toLowerCase().endsWith('.rpk') ? pack : `${pack.replaceAll('.', '/')}.rpk`;
      if (!assets.byPath.has(normalizePath(path))) return;
      resourceCatalog.addPack(path, await assets.pack(path));
    });
  jvm.natives.registerAsync('java.lang.System', 'openLib', ['String'], async ({ args }) => {
    const path = String(args[0].value ?? '').replaceAll('\\', '/');
    const asset = assets.byPath.get(path.toLowerCase());
    if (!asset || !path.toLowerCase().endsWith('.rpk')) return jv('int', 0);
    // Track metadata packs define the children of system:0x3000; large geometry packs can wait.
    if (asset.size <= 2 * 1024 * 1024 || /(?:^|\/)t_data\.rpk$/i.test(path))
      resourceCatalog.addPack(path, await assets.pack(path));
    return jv('int', 1);
  });
  jvm.natives.register('java.lang.System', 'arraycopy', ['Object', 'int', 'Object', 'int', 'int'], ({ args }) => {
    const source = args[0].value, target = args[2].value;
    const from = Number(args[1].value), to = Number(args[3].value), count = Number(args[4].value);
    if (!Array.isArray(source) || !Array.isArray(target)) throw new Error('System.arraycopy requires arrays');
    if (![from, to, count].every(Number.isInteger) || from < 0 || to < 0 || count < 0
      || from + count > source.length || to + count > target.length)
      throw new Error('System.arraycopy index out of bounds');
    const copied = source.slice(from, from + count);
    for (let i = 0; i < count; i++) target[to + i] = copied[i];
    return voidValue();
  });
  const viewports = new ViewportNative(jvm, gameTypes, viewportSize);
  const renderRefs = new RenderRefNative(jvm, gameTypes);
  const cameras = new CameraNative(jvm, gameTypes, viewports);
  let input!: InputNative;
  const controllers = new ControllerNative(jvm, (device, axis) => input.physicalAxis(device, axis));
  input = new InputNative(jvm, controllers, gameTypes);
  new FileNative(jvm, files, gameTypes);
  new FindFileNative(jvm, files, new AssetCatalogAdapter(assets));
  new MathNative(jvm);
  const collector = 'java.lang.GarbageCollector';
  jvm.natives.register(collector, '<init>', [], () => {
    report({ level: 'native', message: 'Host stub: java.lang.GarbageCollector.<init>()' });
    return jv('GarbageCollector', {});
  });
  native(collector, 'push', ['Object']);
  native(collector, 'flush', []);
  native('java.util.resource.ResourceRef', 'precache', []);
  native('java.util.resource.ResourceRef', 'cache', []);
  const controller = 'java.io.Controller';
  jvm.natives.registerField(controller, 'controlFile', jv('String', ''));
  native('java.game.Frontend', 'init', []);
  native('java.game.LoadingScreen', 'show', ['ResourceRef', 'int']);
  native('java.sound.Sound', 'init', []);
  jvm.natives.register('java.sound.Sound', 'enableDebugDump', ['ResourceRef'], () => jv('int', 0));
  native('java.io.Input', 'initControllers', ['Init', 'String'], args => {
    jvm.natives.setField(controller, 'controlFile', args[1]);
  });
  jvm.natives.register('java.io.Input', 'getDeviceName', ['int'], ({ args }) =>
    jv('String', ['SysKeyboard', 'SysMouse'][Number(args[0].value)] ?? null));
  native('java.io.Input', 'enablePointingDevice', []);
  jvm.natives.registerField('java.game.Frontend', 'loadingScreen', jv('LoadingScreen', {}));
  // The original Frontend values are engine-owned. These placeholders only identify precache requests.
  for (const name of ['SFX_MENU_MOVE', 'SFX_MENU_SELECT', 'SFX_QUESTION'])
    jvm.natives.registerField('java.game.Frontend', name, jv('int', 0));

  const entry = `${sourceRoot}Init.java`;
  report({ level: 'info', message: `Entry: ${entry} → new Init(0)` });
  try {
    if (assets.byPath.has('system/scripts/lang/src/string.java')) await jvm.loadClass('java.lang.String');
    await jvm.loadClass('java.game.Init');
    await jvm.constructAsync('java.game.Init', [jv('int', 0)]);
    gameTypes.dispatchQueuedEvents();
    report({ level: 'info', message: 'Init.java completed' });
    return { jvm, gameTypes, viewports, renderRefs, cameras, input, files };
  } catch (reason) {
    const original = reason instanceof Error ? reason : new Error(String(reason));
    const error = new Error(sourceDiagnostic(original.message, sources, assets), { cause: original });
    report({ level: 'error', message: error.message });
    return { jvm, gameTypes, viewports, renderRefs, cameras, input, files, error };
  }
}

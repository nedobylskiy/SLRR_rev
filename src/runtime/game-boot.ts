import { SlrrJvm, jv, type JavaValue, type ResourceIdentity } from 'slrr-jvm';
import { decompileClass, parseTufa } from 'slrr-jvm-decompiler';
import { Assets, normalizePath, normalizeResourcePackPath } from '../assets';
import { GameTypeNative } from './game-type-native';
import { MathNative } from './math-native';
import { VectorNative } from './vector-native';
import { ViewportNative, type ViewportSize } from './viewport-native';
import { CameraNative } from './camera-native';
import { ControllerNative } from './controller-native';
import { InputNative } from './input-native';
import { FileNative } from './file-native';
import { AssetCatalogAdapter, FindFileNative } from './find-file-native';
import { ResourceCatalog } from './resource-catalog';
import { packedResourceId } from './resource-ids';
import { StringNative } from './string-native';
import { PartFactory } from '../engine/world';
import { repairDecompiledSource } from './source-repairs';
import { SystemNative } from './system-native';
import { ThreadNative } from './thread-native';
import { PartNative } from './part-native';
import { ChassisNative } from './chassis-native';
import { DynoNative } from './dyno-native';
import { parsePartConfig } from '../formats/cfg';
import { entryProperties, type RpkPack } from '../formats/rpk';
import { browserKeyValue, type KeyValue } from './key-value';
import { VirtualFileSystem } from './virtual-file-system';
import { RenderRefNative, type RenderLightSettings, type RenderFlareSource } from './render-ref-native';
import type { RenderObject } from './render-object';
import { OsdTextNative } from './osd-text-native';
import { OsdButtonNative } from './osd-button-native';
import { OsdRectangleNative } from './osd-rectangle-native';
import { SfxRefNative } from './sfx-ref-native';
import type { MapFogSettings } from '../render/viewer';
import type { EnvironmentMapSource } from '../render/environment-map';
import { SOUND_CHANNEL } from '../audio/music-engine';
import { osdViewport } from './osd-depth';
import type { OsdLayer } from '../osd/osd-layer';
import type { SoundJavaBridge } from '../audio/sound-java';
import type { OsdVideo } from '../osd/osd-video';

export type BootEvent = { level: 'info' | 'native' | 'error'; message: string };
export type BootResult = { jvm: SlrrJvm; gameTypes: GameTypeNative; parts: PartNative; chassis: ChassisNative; dyno: DynoNative; viewports: ViewportNative; renderRefs: RenderRefNative; cameras: CameraNative; controllers: ControllerNative; input: InputNative; files: VirtualFileSystem; resolveResourceIdentity(id: number): ResourceIdentity | undefined; dispose(): void; error?: Error };

const sourceRoot = 'sl/scripts/game/src/';
const systemRoot = 'system/scripts/';
const voidValue = () => jv('void', undefined);

function sourceDiagnostic(message: string, sources: Map<string, string>, assets: Assets): string {
  const native = /Java native implementation missing: ([\w.]+)\.([\w$]+)\(/.exec(message);
  const nativeClass = native?.[1].split('.').at(-1);
  const declaration = native && [...sources].find(([path]) => path.endsWith(`/src/${nativeClass}.java`.toLowerCase())
    || path.endsWith(`/decompiled/${nativeClass}.java`.toLowerCase())
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
  osd?: Pick<OsdLayer, 'createText' | 'createHitTarget' | 'createRectangle'>,
  sound?: SoundJavaBridge, keyValue: KeyValue = browserKeyValue(), video?: Pick<OsdVideo, 'openVideo' | 'closeVideo' | 'isPlayingVideo' | 'dispose'>,
  setMapFog?: (settings: MapFogSettings) => void,
  setSceneLight?: (settings: RenderLightSettings) => void,
  setGlobalEnvmap?: (source: EnvironmentMapSource | null) => Promise<void> | void,
  setSceneFlare?: (source: RenderFlareSource) => Promise<void> | void): Promise<BootResult> {
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
  const frontendPack = assets.byPath.has('frontend.rpk') ? await assets.pack('frontend.rpk') : null;
  const frontendTextureIds = new Set(frontendPack?.entries.filter(entry => entry.type === 7).map(entry => entry.typeId));
  const partsPack = assets.byPath.has('parts.rpk') ? await assets.pack('parts.rpk') : null;
  const sourcePacks = new Map<string, RpkPack>();
  const packedResources = new Map<number, ResourceIdentity | null>();
  const unlistedResourceSlots = new Map<string, number>();
  let nextUnlistedSlot = 0x7000;
  const resolveResourceIdentity = (id: number) => packedResources.get(id) ?? undefined;
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
    allowNumericNarrowing: true,
    resolveResourceId: (resource, path) => {
      const sourcePath = normalizePath(path);
      const owner = sourcePacks.get(sourcePath)
        ?? (sourcePath.startsWith(sourceRoot) ? frontendPack : null)
        ?? (sourcePath.startsWith('parts/scripts/') ? partsPack : null);
      let packed = owner ? packedResourceId(owner, resource) : undefined;
      if (packed === undefined && Number.isInteger(resource.id) && resource.id >= 0 && resource.id <= 0xffff) {
        const pack = normalizeResourcePackPath(resource.pack);
        if (assets.byPath.has(pack)) {
          let slot = unlistedResourceSlots.get(pack);
          if (slot === undefined) {
            if (nextUnlistedSlot > 0x7fff) throw new Error('Unlisted resource slot range exhausted');
            slot = nextUnlistedSlot++;
            unlistedResourceSlots.set(pack, slot);
          }
          packed = (slot << 16) | resource.id;
        }
      }
      if (packed !== undefined) {
        const prior = packedResources.get(packed);
        if (prior && (prior.pack !== resource.pack || prior.id !== resource.id)) packedResources.set(packed, null);
        else if (!packedResources.has(packed)) packedResources.set(packed, resource);
      }
      return packed;
    },
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
      for (const folder of ['src', 'decompiled']) {
        const sourcePath = path.replace(/\/([^/]+)\.class$/i, `/${folder}/$1.java`);
        if (assets.byPath.has(sourcePath.toLowerCase())) return { path: sourcePath };
      }
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
      const source = repairDecompiledSource(path, new TextDecoder().decode(await assets.read(path)));
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
  const objectNames = new WeakMap<object, number>();
  let nextObjectName = 1;
  jvm.natives.register('java.lang.Object', 'toString', [], ({ receiver }) => {
    const value = receiver.value;
    const className = value && typeof value === 'object' && 'className' in value
      ? String(value.className) : receiver.type;
    if (!value || typeof value !== 'object') return jv('String', className);
    let identity = objectNames.get(value);
    if (identity === undefined) { identity = nextObjectName++; objectNames.set(value, identity); }
    return jv('String', `${className}@${identity.toString(16)}`);
  });
  const system = new SystemNative(jvm, report);
  const threads = new ThreadNative(jvm, message => report({ level: 'error', message }));
  let viewports!: ViewportNative;
  const viewportLayout = (group: JavaValue) => osdViewport(group, viewports);
  const stageAspect = () => {
    const { width, height } = viewportSize();
    return height > 0 ? width / height : 16 / 9;
  };
  const osdText = new OsdTextNative(jvm, osd, viewportLayout);
  const osdButtons = new OsdButtonNative(jvm, osd,
    error => report({ level: 'error', message: `OSD click: ${error.message}` }), viewportLayout, stageAspect);
  let osdRectangles: OsdRectangleNative | undefined;
  let chassisNative!: ChassisNative;
  let partNative!: PartNative;
  const resourceCatalog = new ResourceCatalog(await Promise.all(['system.rpk', 'cars.rpk']
    .filter(path => assets.byPath.has(normalizePath(path)))
    .map(async path => [path, await assets.pack(path)] as const)));
  const gameTypes = new GameTypeNative(jvm, report, node => {
    if (!osdRectangles?.sync(node)) renderChanged?.(node);
  }, resourceCatalog,
    async (script, typeId, pack) => {
      const compiled = normalizePath(script);
      const sourcePath = compiled.endsWith('.class')
        ? compiled.replace(/\/([^/]+)\.class$/i, '/src/$1.java')
        : javaSourcesByName.get(`${compiled.split('.').at(-1)}.java`)?.[0] ?? compiled;
      const source = assets.byPath.get(normalizePath(sourcePath));
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
      if (pack && assets.byPath.has(normalizePath(pack)))
        sourcePacks.set(normalizePath(source.path), await assets.pack(pack));
      await jvm.loadClass(className);
      const cfgPath = pack && resourceCatalog.resolve(pack, typeId)?.cfgPath;
      const cfg = cfgPath && assets.byPath.has(cfgPath)
        ? parsePartConfig(new TextDecoder('windows-1252').decode(await assets.read(cfgPath))) : null;
      chassisNative.prepare(className, cfg?.maxSteer ?? 0.7, cfg?.ackermann ?? 2);
      const constructors = [...content.matchAll(new RegExp(`\\b${simpleName}\\s*\\(([^)]*)\\)`, 'g'))];
      const takesId = constructors.some(match => /^\s*int\s+\w+\s*$/.test(match[1]));
      const instance = await jvm.constructAsync(className, takesId ? [jv('int', typeId)] : []);
      partNative.configure(instance, cfg);
      return instance;
    }, async pack => {
      const path = pack.toLowerCase().endsWith('.rpk') ? pack : `${pack.replaceAll('.', '/')}.rpk`;
      if (!assets.byPath.has(normalizePath(path))) return;
      resourceCatalog.addPack(path, await assets.pack(path));
    }, id => packedResources.get(id) ?? undefined, node => osdRectangles?.remove(node),
    async (receiver, cfgPath) => {
      const cfg = parsePartConfig(new TextDecoder('windows-1252').decode(await assets.read(cfgPath)));
      partNative.configure(receiver, cfg);
    });
  jvm.natives.register('java.util.resource.GroundRef', 'setFog', ['int', 'float', 'float'], ({ receiver, args }) => {
    if (!gameTypes.get(receiver)) throw new Error('GroundRef.setFog has no map game object');
    const color = Number(args[0].value) & 0xffffff;
    const near = Number(args[1].value), far = Number(args[2].value);
    if (!Number.isFinite(near) || !Number.isFinite(far) || near < 0 || far <= near)
      throw new Error(`Invalid GroundRef fog range: ${near}..${far}`);
    setMapFog?.({ color, near, far });
    return voidValue();
  });
  // MOCK: The road-intersection graph is not imported yet. A null result follows
  // the original Track.changeCamTV() branch for maps without a nearby crossing.
  for (const distanceType of ['int', 'float'])
    jvm.natives.register('java.util.resource.GroundRef', 'getNearestCross', ['Vector3', distanceType], () => jv('Vector3', null));
  const sfxRefs = new SfxRefNative(jvm, assets, gameTypes,
    () => Number(sound?.call('getVolume', [jv('int', SOUND_CHANNEL.EFFECTS)]).value ?? 1),
    error => report({ level: 'error', message: `SfxRef: ${error.message}` }));
  osdRectangles = new OsdRectangleNative(gameTypes, osd, id =>
    packedResources.get(id) ?? (frontendTextureIds.has(id) ? { pack: 'frontend', id } : undefined), viewportLayout, stageAspect);
  chassisNative = new ChassisNative(jvm, gameTypes);
  const partFactory = new PartFactory(assets);
  partNative = new PartNative(jvm, gameTypes, async (parent, parentSlot, child, childSlot) => {
    const key = (node: typeof parent) => {
      const identity = resolveResourceIdentity(node.typeId);
      return identity ? { pack: normalizeResourcePackPath(identity.pack), id: identity.id }
        : node.resourcePack ? { pack: normalizeResourcePackPath(node.resourcePack), id: node.typeId } : null;
    };
    const parentKey = key(parent), childKey = key(child);
    return !!parentKey && !!childKey && await partFactory.compatibleSlots(parentKey, parentSlot, childKey, childSlot);
  });
  gameTypes.setRenderCountReader(receiver => partNative.cameraCount(receiver));
  const dyno = new DynoNative(jvm);
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
  viewports = new ViewportNative(jvm, gameTypes, viewportSize);
  const renderRefs = new RenderRefNative(jvm, gameTypes,
    (receiver, position) => osdText.setRenderMatrix(receiver, position), setSceneLight,
    async (texture, light, settings) => {
      if (!setSceneFlare) return;
      let phase = 'resolve texture resource';
      try {
        if (!texture.resourcePack) throw new Error('RenderRef.setFlare texture has no pack');
        const { entry } = await assets.resource(texture.resourcePack, texture.resourceId & 0xffff);
        if (entry.type !== 7) throw new Error(`RenderRef.setFlare expected texture, got type ${entry.type}`);
        const path = entryProperties(entry).find(property => property.key === 'sourcefile')?.value;
        if (!path) throw new Error('RenderRef.setFlare texture has no sourcefile');
        phase = 'resolve light direction';
        const lightId = (light.copiedFromResourceId ?? light.resourceId) & 0xffff;
        const lightEntry = light.resourcePack ? (await assets.resource(light.resourcePack, lightId)).entry : null;
        const directionText = lightEntry && entryProperties(lightEntry).find(property => property.key === 'direction')?.value;
        const direction = directionText?.split(/\s+/).map(Number);
        const sunDirection = direction?.length === 3 && direction.every(Number.isFinite)
          ? { x: -direction[0], y: -direction[1], z: -direction[2] } : undefined;
        phase = `read texture ${path}`;
        const bytes = await assets.read(path);
        phase = `render texture ${path}`;
        await setSceneFlare({ ...settings, path, bytes, sunDirection });
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message || reason.name : String(reason);
        throw new Error(`RenderRef.setFlare ${phase}: ${detail || 'unknown error'}`, { cause: reason });
      }
    });
  const cameras = new CameraNative(jvm, gameTypes, viewports);
  let input!: InputNative;
  const controllers = new ControllerNative(jvm, (device, axis) => input.physicalAxis(device, axis));
  input = new InputNative(jvm, controllers, gameTypes);
  gameTypes.setAxisReader((receiver, axis) => controllers.read(receiver, axis));
  jvm.natives.register('java.game.Vehicle', 'getSpeedSquare', [], ({ receiver }) => {
    const velocity = gameTypes.get(receiver)?.velocity;
    return jv('float', velocity ? velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2 : 0);
  });
  new FileNative(jvm, files, gameTypes);
  new FindFileNative(jvm, files, new AssetCatalogAdapter(assets));
  new MathNative(jvm);
  new VectorNative(jvm);
  const collector = 'java.lang.GarbageCollector';
  jvm.natives.register(collector, '<init>', [], () => {
    report({ level: 'native', message: 'Host stub: java.lang.GarbageCollector.<init>()' });
    return jv('GarbageCollector', {});
  });
  native(collector, 'push', ['Object']);
  native(collector, 'flush', []);
  native('java.util.resource.ResourceRef', 'precache', []);
  native('java.util.resource.ResourceRef', 'cache', []);
  // MOCK: Track.exit cleanup for map systems not yet hosted by the engine.
  native('java.util.resource.GroundRef', 'delTraffic', []);
  native('java.util.resource.GroundRef', 'setPedestrianDensityN', ['float']);
  // MOCK: Traffic simulation is not hosted yet. Let city setup finish; no traffic cars are spawned.
  for (const countType of ['int', 'float']) jvm.natives.register('java.util.resource.GroundRef', 'addTrafficN',
    ['GameRef', countType, 'float', 'float', 'float'], ({ args }) => {
      report({ level: 'native', message: `Host mock: GroundRef.addTrafficN(${countType}) skipped ${Number(args[1].value)} traffic cars` });
      return jv('int', 0);
    });
  // MOCK: Water-plane rendering is pending; Track.animate still needs its water bounds calls.
  jvm.natives.register('java.util.resource.GroundRef', 'setWater', ['Vector3', 'Vector3', 'float', 'float'], voidValue);
  jvm.natives.register('java.util.resource.GroundRef', 'addWaterLimit', ['Vector3', 'Vector3'], voidValue);
  native('java.util.resource.ResourceRef', 'unload', []);
  const controller = 'java.io.Controller';
  jvm.natives.registerField(controller, 'controlFile', jv('String', ''));
  native('java.game.Frontend', 'init', []);
  const realLoadingScreen = ['src/loadingscreen.java', 'decompiled/loadingscreen.java', 'loadingscreen.class']
    .some(path => assets.byPath.has(`system/scripts/render/${path}`));
  if (!realLoadingScreen) native('java.game.LoadingScreen', 'show', ['ResourceRef', 'int']);
  jvm.natives.register('java.render.GfxEngine', 'forceRendering', [], () => voidValue());
  native('java.render.GfxEngine', 'flush', []);
  // Browser viewport dimensions are authoritative; Java may list the current
  // mode for its options UI, but cannot change the browser's display mode.
  const displayMode = () => {
    const size = viewportSize();
    return `${Math.max(1, Math.round(size.width))} ${Math.max(1, Math.round(size.height))} 32 1`;
  };
  jvm.natives.register('java.render.GfxEngine', 'numDisplayModes', [], () => jv('int', 1));
  jvm.natives.register('java.render.GfxEngine', 'currDisplayMode', [], () => jv('int', 0));
  jvm.natives.register('java.render.GfxEngine', 'displayModeName', ['int'], () => jv('String', displayMode()));
  jvm.natives.register('java.render.GfxEngine', 'changeVideoMode', ['int', 'int', 'int'], () => voidValue());
  jvm.natives.registerAsync('java.render.GfxEngine', 'setGlobalEnvmap', ['ResourceRef'], async ({ args }) => {
    if (args[0].value == null) { await setGlobalEnvmap?.(null); return voidValue(); }
    const resource = gameTypes.getResource(args[0]);
    if (!resource) throw new Error('GfxEngine.setGlobalEnvmap has no resource handle');
    if (!resource.resourceId) { await setGlobalEnvmap?.(null); return voidValue(); }
    if (!resource.resourcePack) throw new Error('GfxEngine.setGlobalEnvmap has no texture pack');
    // The Java handle exposes the owner's packed dependency slot; resourcePack already names the target RPK.
    const { entry } = await assets.resource(resource.resourcePack, resource.resourceId & 0xffff);
    if (entry.type !== 7) throw new Error(`GfxEngine.setGlobalEnvmap expected a texture, got type ${entry.type}`);
    const path = entryProperties(entry).find(property => property.key === 'sourcefile')?.value;
    if (!path) throw new Error('GfxEngine.setGlobalEnvmap texture has no sourcefile');
    await setGlobalEnvmap?.({ path, bytes: await assets.read(path) });
    return voidValue();
  });
  for (const signature of [['String', 'int', 'int'], ['String', 'int', 'int', 'int']])
    jvm.natives.register('java.render.GfxEngine', 'openVideo', signature, ({ args }) =>
      jv('int', video?.openVideo(String(args[0].value), Number(args[1].value) !== 0) ?? 1));
  jvm.natives.register('java.render.GfxEngine', 'closeVideo', [], () => { video?.closeVideo(); return voidValue(); });
  jvm.natives.register('java.render.GfxEngine', 'isPlayingVideo', [], () => jv('int', video?.isPlayingVideo() ?? 0));
  // Navigator.java owns route data and camera setup. Its engine update is
  // deferred until the navigator viewport can render a map in the browser.
  jvm.natives.register('java.game.Navigator', 'updateNavigator', ['GameRef', 'int'], () => voidValue());
  native('java.sound.Sound', 'init', []);
  for (const [name, signature, resultType] of [
    ['changeMusicSet', ['int'], 'void'], ['nextTrack', [], 'void'], ['prevTrack', [], 'void'],
    ['firstTrack', [], 'void'], ['randomTrack', [], 'void'], ['stopMusic', [], 'void'],
    ['playTrack', ['int'], 'void'], ['playTrack', ['String'], 'void'],
    ['getTotalTracks', [], 'int'], ['getNowPlaying', [], 'int'],
    ['setVolume', ['int', 'float'], 'void'], ['getVolume', ['int'], 'float'],
  ] as const)
    jvm.natives.register('java.sound.Sound', name, signature, ({ args }) =>
      sound?.call(name, [...args]) ?? jv(resultType, resultType === 'void' ? undefined : 0));
  jvm.natives.register('java.sound.Sound', 'enableDebugDump', ['ResourceRef'], () => jv('int', 0));
  native('java.io.Input', 'initControllers', ['Init', 'String'], args => {
    jvm.natives.setField(controller, 'controlFile', args[1]);
  });
  jvm.natives.register('java.io.Input', 'getDeviceName', ['int'], ({ args }) =>
    jv('String', ['SysKeyboard', 'SysMouse'][Number(args[0].value)] ?? null));
  native('java.io.Input', 'enablePointingDevice', []);
  if (['src/object.java', 'decompiled/object.java', 'object.class']
    .some(path => assets.byPath.has(`system/scripts/lang/${path}`)))
    await jvm.loadClass('java.lang.Object');
  if (realLoadingScreen) {
    await jvm.loadClass('java.render.LoadingScreen');
    await jvm.loadClass('java.render.Frontend');
    await jvm.globalAsync('java.render.Frontend');
    await jvm.invokeAsync(jv('class', 'java.render.Frontend'), 'setFonts');
  }
  const loadingScreen = realLoadingScreen
    ? jv('LoadingScreen', { className: 'java.render.LoadingScreen', fields: new Map([
      ['init', jv('int', 0)],
      ['waitForUser', jv('int', 0)],
      ['waitForUserTimeLimit', jv('float', -1)],
      ['loadingDialog', jv('LoadingDialog', null)],
      ['flashTextThread', jv('Thread', null)],
      ['fadeThread', jv('Thread', null)],
      ['termSig', jv('Object', { className: 'java.lang.Object', fields: new Map() })],
    ]) }) : jv('LoadingScreen', {});
  jvm.natives.registerField('java.game.Frontend', 'loadingScreen', loadingScreen);
  if (realLoadingScreen) jvm.natives.registerField('java.render.Frontend', 'loadingScreen', loadingScreen);
  const renderSignal = jv('GfxEngine', { className: 'java.render.GfxEngine', fields: new Map() });
  if (realLoadingScreen) {
    jvm.natives.registerField('java.render.Frontend', 'render', renderSignal);
    jvm.natives.registerField('java.game.Frontend', 'render', renderSignal);
    jvm.natives.registerField('java.game.Frontend', 'inputQueue',
      jvm.get(jv('class', 'java.render.Frontend'), 'inputQueue'));
    for (const name of ['largeFont', 'mediumFont', 'smallFont', 'largeFont_strong', 'smallFont_strong',
      'largeFont_russian', 'largeFont_scale', 'smallFont_scale', 'largeFont_strong_scale',
      'smallFont_strong_scale', 'largeFont_russian_scale', 'defLoadingPic', 'fadeRes', 'fadeRes_HD', 'pointers',
      'SFX_MENU_MOVE', 'SFX_MENU_SELECT', 'SFX_QUESTION'])
      jvm.natives.registerField('java.game.Frontend', name,
        jvm.get(jv('class', 'java.render.Frontend'), name));
  }
  // The original Frontend values are engine-owned. These placeholders only identify precache requests.
  if (!realLoadingScreen) for (const name of ['SFX_MENU_MOVE', 'SFX_MENU_SELECT', 'SFX_QUESTION'])
    jvm.natives.registerField('java.game.Frontend', name, jv('int', 0));

  const entry = `${sourceRoot}Init.java`;
  let renderTicker: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    if (renderTicker) clearInterval(renderTicker);
    sfxRefs.dispose(); gameTypes.dispose(); threads.dispose(); osdText.dispose(); osdButtons.dispose(); osdRectangles?.dispose(); video?.dispose();
  };
  report({ level: 'info', message: `Entry: ${entry} → new Init(0)` });
  try {
    if (['src', 'decompiled'].some(folder => assets.byPath.has(`system/scripts/lang/${folder}/string.java`)))
      await jvm.loadClass('java.lang.String');
    await jvm.loadClass('java.game.Init');
    if (realLoadingScreen) {
      system.beginLoading();
      renderTicker = setInterval(() => {
        osdButtons.sync();
        osdText.syncVisibility();
        osdRectangles?.syncVisibility();
        jvm.natives.invoke('java.lang.Object', 'notifyAll', renderSignal, []);
      }, 50);
      void jvm.invokeAsync(loadingScreen, 'run').catch(reason => {
        if (!disposed) report({ level: 'error', message: `LoadingScreen.run: ${reason instanceof Error ? reason.message : String(reason)}` });
      });
    }
    await jvm.constructAsync('java.game.Init', [jv('int', 0)]);
    gameTypes.dispatchQueuedEvents();
    report({ level: 'info', message: 'Init.java completed' });
    return { jvm, gameTypes, parts: partNative, chassis: chassisNative, dyno, viewports, renderRefs, cameras, controllers, input, files, resolveResourceIdentity, dispose };
  } catch (reason) {
    const original = reason instanceof Error ? reason : new Error(String(reason));
    const error = new Error(sourceDiagnostic(original.message || original.name, sources, assets), { cause: original });
    report({ level: 'error', message: error.message });
    return { jvm, gameTypes, parts: partNative, chassis: chassisNative, dyno, viewports, renderRefs, cameras, controllers, input, files, resolveResourceIdentity, dispose, error };
  }
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assets } from '../src/assets';
import { bootGame, type BootEvent } from '../src/runtime/game-boot';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { SlrrJvm, jv } from 'slrr-jvm';
import { SoundJavaBridge } from '../src/audio/sound-java';
import type { MusicEngine } from '../src/audio/music-engine';
import { compileSource } from 'slrr-jvm-compiler';

test('avatar RID arithmetic retains the namespace of a class-only installation', async () => {
  const source = `package java.game; class Init extends GameType {
    static final int base = frontend:0x00dar;
    Init(int id) { reachedInit(); }
    static int avatar(int offset) { return base + offset; }
  }`;
  const assets = new Assets([{path:'frontend.rpk',size:0},
    {path:'sl/scripts/game/src/Init.java',size:source.length}], async()=>new TextEncoder().encode(source));
  assets.pack = async()=>({version:0x200,dependencies:[],warnings:[],entries:[]});
  const result = await bootGame(assets,()=>{});
  try {
    assert.match(result.error?.message ?? '', /reachedInit/);
    for (const offset of [0,1,38,59]) {
      const value = await result.jvm.invokeAsync(jv('class','java.game.Init'),'avatar',[jv('int',offset)]);
      assert.equal(result.resolveResourceIdentity(Number(value.value))?.pack.replace('.rpk',''),'frontend');
      assert.equal(result.resolveResourceIdentity(Number(value.value))?.id,0xda+offset);
    }
  } finally { result.dispose(); }
});

test('class-only String loads Java token wrappers before game startup', async () => {
  const compiled = compileSource(`package java.lang; public class String {
    public String token(int index) { return token(index, " \\t\\n"); }
    public native String token(int index, String separators);
  }`);
  assert.equal(compiled.ok, true, compiled.diagnostics.join('\n'));
  const files = new Map<string, Uint8Array>([
    ['system/scripts/lang/String.class', compiled.bytes],
    ['sl/scripts/game/src/Init.java', new TextEncoder().encode(`package java.game;
      class Init extends GameType { Init(int id) {
        String mode = "1600\\t900\\n32";
        if (mode.token(1) != "900") wrongToken();
        reachedAfterToken();
      } }`)],
  ]);
  const assets = new Assets([...files].map(([path, bytes]) => ({ path, size: bytes.length })),
    async path => files.get(path)!);
  const result = await bootGame(assets, () => {});
  try {
    assert.match(result.error?.message ?? '', /reachedAfterToken/);
  } finally { result.dispose(); }
});

test('Init.java controls the OSD video through both GfxEngine.openVideo overloads', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', `package java.game; import java.render.*;
      class Init extends GameType { Init(int id) {
        if (GfxEngine.openVideo("data/fmv/intro.avi", 1, 1, 1) != 0) wrongOpen();
        if (!GfxEngine.isPlayingVideo()) wrongState();
        GfxEngine.closeVideo();
        if (GfxEngine.isPlayingVideo()) wrongClose();
        if (GfxEngine.openVideo("data/fmv/outro.avi", 0, 0) != 0) wrongOverload();
        missingNext();
      } }`],
    ['system/scripts/render/src/GfxEngine.java', `package java.render; class GfxEngine {
      static native int openVideo(String path, int a, int b, int c);
      static native int openVideo(String path, int a, int b);
      static native void closeVideo(); static native int isPlayingVideo(); }`],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })),
    async path => new TextEncoder().encode(sources.get(path)!));
  const opened: { path: string; loop: boolean }[] = [];
  let playing = false;
  const video = {
    openVideo(path: string, loop: boolean) { opened.push({ path, loop }); playing = true; return 0; },
    closeVideo() { playing = false; },
    isPlayingVideo() { return Number(playing); },
    dispose() { playing = false; },
  };
  const result = await bootGame(assets, () => {}, undefined, undefined, undefined, undefined, undefined, video);
  assert.deepEqual(opened, [
    { path: 'data/fmv/intro.avi', loop: true },
    { path: 'data/fmv/outro.avi', loop: false },
  ]);
  assert.match(result.error?.message ?? '', /missingNext/);
  result.dispose();
  assert.equal(playing, false);
});

test('browser display mode is reported to Java but cannot be changed by Java', async () => {
  const source = 'package java.game; class Init extends GameType { Init(int id) { missingNext(); } }';
  const assets = new Assets([{ path: 'sl/scripts/game/src/Init.java', size: source.length }],
    async () => new TextEncoder().encode(source));
  const result = await bootGame(assets, () => {}, () => ({ width: 1600, height: 900 }));
  const gfx = 'java.render.GfxEngine';
  assert.equal(result.jvm.natives.invoke(gfx, 'numDisplayModes', jv('class', gfx), [])?.value, 1);
  assert.equal(result.jvm.natives.invoke(gfx, 'currDisplayMode', jv('class', gfx), [])?.value, 0);
  assert.equal(result.jvm.natives.invoke(gfx, 'displayModeName', jv('class', gfx), [jv('int', 0)])?.value,
    '1600 900 32 1');
  assert.equal(result.jvm.natives.invoke(gfx, 'changeVideoMode', jv('class', gfx),
    [jv('int', 1920), jv('int', 1080), jv('int', 32)])?.type, 'void');
  assert.equal(result.jvm.natives.invoke(gfx, 'displayModeName', jv('class', gfx), [jv('int', 0)])?.value,
    '1600 900 32 1');
  assert.equal(result.jvm.natives.invoke('java.game.Navigator', 'updateNavigator', jv('Navigator', {}),
    [jv('GameRef', null), jv('int', 1)])?.type, 'void');
  result.dispose();
});

test('GroundRef.setFog forwards the original color and distances to the map renderer', async () => {
  const source = 'package java.game; class Init extends GameType { Init(int id) { missingNext(); } }';
  const assets = new Assets([{ path: 'sl/scripts/game/src/Init.java', size: source.length }],
    async () => new TextEncoder().encode(source));
  const fog: { color: number; near: number; far: number }[] = [];
  const result = await bootGame(assets, () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, settings => fog.push(settings));
  const ground = jv('GroundRef', { className: 'java.util.resource.GroundRef', fields: new Map() });
  result.jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', ground, []);
  result.jvm.natives.invoke('java.util.resource.ResourceRef', 'set', ground, [jv('int', 7)]);
  assert.equal(result.jvm.natives.invoke('java.util.resource.GroundRef', 'setFog', ground,
    [jv('int', 0x0007121e), jv('float', 20), jv('float', 150)])?.type, 'void');
  assert.deepEqual(fog, [{ color: 0x07121e, near: 20, far: 150 }]);
  result.dispose();
});

test('GroundRef loads its own road graph and returns an independent vector usable by Java mul', async () => {
  const sources = new Map([
    ['system/scripts/util/resource/src/GameRef.java', 'package java.util.resource; class GameRef {}'],
    ['sl/scripts/game/src/Init.java', `package java.game; import java.util.resource.*;
      class Init extends GameType {
        Init(int id) { missingNext(); }
        Vector3 trafficSpawn(GroundRef map, Vector3 start) { return map.getNearestCross(start).mul(2.0); }
        int declareTraffic(GroundRef map, GameRef type) { return map.addTrafficN(type,40,2.0,5.0,2.0); }
        int registerTraffic(GroundRef map, GameRef car, Vector3 pos) {
          int id=map.addTrafficCar(car,pos); return map.notifyTrafficCar(id,1);
        }
        void unregisterTraffic(GroundRef map, int id) { map.remTrafficCar(id); }
      }`],
    ['system/scripts/util/resource/src/GroundRef.java', `package java.util.resource;
      class GroundRef extends GameRef {
        Vector3 getNearestCross(Vector3 start) { return getNearestCross(start,0.0); }
        native Vector3 getNearestCross(Vector3 start, float distance);
        native int addTrafficN(GameRef type, int count, float a, float b, float c);
        native int addTrafficCar(GameRef car, Vector3 pos);
        native int notifyTrafficCar(int id, int enabled);
        native void remTrafficCar(int id);
      }`],
    ['system/scripts/lang/src/Vector3.java', `package java.lang; class Vector3 {
      float x; float y; float z;
      Vector3 mul(Vector3 v) { x*=v.x; y*=v.y; z*=v.z; return this; }
      Vector3 mul(float n) { x*=n; y*=n; z*=n; return this; }
    }`],
  ]);
  const roadPath='maps/native-test/ai/native.trc',bytes=new Uint8Array(44),view=new DataView(bytes.buffer);
  view.setUint32(0,1,true);view.setUint32(4,1,true); // One pool-A crossing, zero links/lanes.
  [12,-16,22].forEach((n,i)=>view.setFloat32(28+i*4,n,true));
  const assets = new Assets([...sources].map(([path,text])=>({path,size:text.length})).concat([{path:roadPath,size:bytes.length}]),
    async path=>path===roadPath?bytes:new TextEncoder().encode(sources.get(path)!));
  assets.pack=async()=>({version:0x200,dependencies:[],warnings:[],entries:[{superId:0,typeId:7,type:1,flags:0,compatibility:0,offset:0,size:0,alias:'ground',data:new TextEncoder().encode(`road ${roadPath}`)}]});
  const result = await bootGame(assets,()=>{});
  try {
    assert.match(result.error?.message ?? '', /missingNext/);
    const jvm=result.jvm;
    const ground=jv('GroundRef',{className:'java.util.resource.GroundRef',fields:new Map()});
    const groundId=result.gameTypes.remountSavedResource('maps/native-test.rpk',7);
    jvm.natives.invoke('java.util.resource.ResourceRef','set',ground,[groundId]);
    const start=jv('Vector3',{className:'java.lang.Vector3',fields:new Map([
      ['x',jv('float',10)],['y',jv('float',-17)],['z',jv('float',20)],
    ])});
    const receiver=jv('Init',{className:'java.game.Init',fields:new Map()});
    const taxi=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
    jvm.natives.invoke('java.util.resource.ResourceRef','set',taxi,[result.gameTypes.remountSavedResource('cars/traffic/Taxi.rpk',6)]);
    assert.equal((await jvm.invokeAsync(receiver,'declareTraffic',[ground,taxi])).value,1);
    assert.deepEqual(result.traffic.models(ground)?.map(model=>[model.pack,model.id,model.weight]),[['cars/traffic/taxi.rpk',6,40]]);
    const position=await jvm.invokeAsync(receiver,'trafficSpawn',[ground,start]);
    assert.deepEqual(['x','y','z'].map(axis=>jvm.get(position,axis).value),[24,-32,44]);
    assert.deepEqual(['x','y','z'].map(axis=>jvm.get(start,axis).value),[10,-17,20],'traffic placement must not mutate the saved race start');
    const car=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',car,[jv('GameRef',ground.value),result.gameTypes.remountSavedResource('cars/traffic/Taxi.rpk',6),jv('String',null),jv('String','bot')]);
    result.gameTypes.getResource(car)!.resourcePack='cars/traffic/taxi.rpk';
    assert.equal((await jvm.invokeAsync(receiver,'registerTraffic',[ground,car,position])).value,1);
    assert.equal((await jvm.invokeAsync(receiver,'registerTraffic',[ground,car,jv('Vector3',null)])).value,1,'repeat registration keeps the same identity');
    const registration=result.traffic.models(ground)!.find(model=>model.registrationId)!;
    for(const id of [0,registration.registrationId!])assert.equal((await jvm.invokeAsync(receiver,'unregisterTraffic',[ground,jv('int',id)])).type,'void');
    assert.equal(result.traffic.models(ground)?.length,1,'individual Bot cleanup must not clear the streamed model catalog');
    for (const type of ['int','float']) {
      const found=await jvm.natives.invokeAsync('java.util.resource.GroundRef','getNearestCross',ground,[start,jv(type,100)]);
      assert.deepEqual(['x','y','z'].map(axis=>jvm.get(found!,axis).value),[12,-16,22],'radius is not a cutoff; returned vector is not shared with prior Java mul');
      assert.equal((await jvm.natives.invokeAsync('java.util.resource.GroundRef','getNearestCross',ground,[jv('Vector3',null),jv(type,0)]))?.value,null);
    }
  } finally { result.dispose(); }
});

test('RenderRef.setLight reaches the scene light bridge during Java boot', async () => {
  const source = 'package java.game; class Init extends GameType { Init(int id) { missingNext(); } }';
  const assets = new Assets([{ path: 'sl/scripts/game/src/Init.java', size: source.length }],
    async () => new TextEncoder().encode(source));
  const light: { diffuse: number; ambient: number; specular: number }[] = [];
  const result = await bootGame(assets, () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, settings => light.push(settings));
  const sun = jv('RenderRef', { className: 'java.util.resource.RenderRef', fields: new Map() });
  result.jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', sun, []);
  result.jvm.natives.invoke('java.util.resource.RenderRef', 'setLight', sun,
    [jv('int', 0xd8d4b0), jv('int', 0x375070), jv('int', 0xd8d4b0)]);
  assert.deepEqual(light, [{ diffuse: 0xd8d4b0, ambient: 0x375070, specular: 0xd8d4b0 }]);
  result.dispose();
});

test('GfxEngine.setGlobalEnvmap resolves a Java texture resource to its source image', async () => {
  const source = 'package java.game; class Init extends GameType { Init(int id) { missingNext(); } }';
  const texturePath = 'maps/skydome/envmaps/Cloudy_day01_envmap.dds';
  const pixels = Uint8Array.of(0x44, 0x44, 0x53, 0x20);
  const assets = new Assets([
    { path: 'sl/scripts/game/src/Init.java', size: source.length },
    { path: texturePath, size: pixels.length },
  ], async path => path === texturePath ? pixels : new TextEncoder().encode(source));
  assets.resource = async (pack, id) => {
    assert.equal(pack, 'maps.skydome');
    assert.equal(id, 0x29);
    return { packPath: 'maps/skydome.rpk', entry: { type: 7,
      data: new TextEncoder().encode(`sourcefile ${texturePath}`) } as Awaited<ReturnType<Assets['resource']>>['entry'] };
  };
  const selected: ({ path: string; bytes: Uint8Array } | null)[] = [];
  const result = await bootGame(assets, () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, texture => { selected.push(texture); });
  const envmap = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  result.jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', envmap, []);
  result.jvm.natives.invoke('java.util.resource.ResourceRef', 'set', envmap,
    [jv('ResourceRef', { pack: 'maps.skydome', id: 0x29 })]);
  const gfx = jv('class', 'java.render.GfxEngine');
  assert.equal((await result.jvm.natives.invokeAsync('java.render.GfxEngine', 'setGlobalEnvmap', gfx,
    [envmap]))?.type, 'void');
  assert.deepEqual(selected, [{ path: texturePath, bytes: pixels }]);
  await result.jvm.natives.invokeAsync('java.render.GfxEngine', 'setGlobalEnvmap', gfx, [jv('ResourceRef', null)]);
  assert.equal(selected.at(-1), null);
  const empty = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  result.jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', empty, []);
  await result.jvm.natives.invokeAsync('java.render.GfxEngine', 'setGlobalEnvmap', gfx, [empty]);
  assert.equal(selected.at(-1), null);
  result.dispose();
});

test('inherited Object.toString gives Java thread owners stable names', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', 'package java.game; class Init extends GameType { Init(int id) { missingNext(); } }'],
    ['system/scripts/lang/decompiled/Object.java', 'package java.lang; class Object { native String toString(); }'],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })),
    async path => new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  const owner = jv('Object', { className: 'java.lang.Object', fields: new Map() });
  const first = result.jvm.invoke(owner, 'toString').value;
  assert.match(String(first), /^java\.lang\.Object@[0-9a-f]+$/);
  assert.equal(result.jvm.invoke(owner, 'toString').value, first);
  result.dispose();
});

test('Init.java routes original Sound music calls through the player', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', `package java.game; import java.sound.*;
      class Init extends GameType { Init(int id) {
        Sound.changeMusicSet(Sound.MUSIC_SET_MENU);
        Sound.playTrack(1);
        Sound.playTrack("Music\\Misc_Menu\\ending.mp3");
        missingNext();
      } }`],
    ['system/scripts/sound/src/Sound.java', `package java.sound; class Sound {
      static final int MUSIC_SET_MENU = 3; static native void changeMusicSet(int set);
      static native void playTrack(int index); static native void playTrack(String path); }`],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })),
    async path => new TextEncoder().encode(sources.get(path)!));
  const selected: number[] = [];
  const sound = new SoundJavaBridge({ changeMusicSet: (set: number) => selected.push(set),
    playTrack: (index: number) => selected.push(index + 10),
    playPath: (path: string) => selected.push(path.includes('ending.mp3') ? 20 : -1) } as unknown as MusicEngine);
  const result = await bootGame(assets, () => {}, undefined, undefined, undefined, sound);
  assert.deepEqual(selected, [1, 11, 20]);
  assert.match(result.error?.message ?? '', /missingNext/);
  result.dispose();
});

test('boot executes supplied Init.java and reports the next missing Java method', async () => {
  const path = 'sl/scripts/game/src/Init.java';
  const run = async (method: string) => {
    const source = `package java.game; class Init extends GameType { Init(int id) { Frontend.init(); ${method}(); } }`;
    const assets = new Assets([{ path, size: source.length }], async () => new TextEncoder().encode(source));
    const events: BootEvent[] = [];
    const result = await bootGame(assets, event => events.push(event));
    return { result, events };
  };
  const first = await run('missingOne');
  assert.match(first.result.error?.message ?? '', /Init\.Init \(source line 1\): Java method\/native missing: java\.game\.Init\.missingOne\(\)/);
  assert.ok(first.events.some(event => event.message.includes('Frontend.init')));
  const second = await run('missingTwo');
  assert.match(second.result.error?.message ?? '', /missingTwo/);
  assert.ok(second.events.some(event => event.level === 'error'));
});

test('GameType inherited no-argument wrapper creates a node linked to the Java object', async () => {
  const events: BootEvent[] = [];
  const source = 'package java.game; class Vehicle extends GameType { Vehicle() { createNativeInstance(); } }';
  const jvm = new SlrrJvm({
    resolveImport: ({ className }) => className === 'java.game.Vehicle' ? { path: 'Vehicle.java', source } : null,
  });
  const host = new GameTypeNative(jvm, event => events.push(event));
  await jvm.loadClass('java.game.Vehicle');
  const vehicle = jvm.construct('java.game.Vehicle', []);
  const node = host.get(vehicle)!;
  assert.equal(node.id, 1);
  assert.equal(node.className, 'java.game.Vehicle');
  assert.equal(node.parentId, null);
  assert.equal(node.typeId, 0);
  assert.equal(node.params, null);
  assert.equal(node.alias, 'Vehicle');
  assert.deepEqual(node.position, { x: 0, y: 0, z: 0 });
  assert.ok(events.some(event => event.message.includes('GameType instance #1')));
});

test('GarbageCollector can be constructed and its temporary methods are explicit host stubs', async () => {
  const path = 'sl/scripts/game/src/Init.java';
  const source = 'package java.game; class Init extends GameType { Init(int id) { GarbageCollector gc = new GarbageCollector(); gc.push(null); gc.flush(); missingNext(); } }';
  const assets = new Assets([{ path, size: source.length }], async () => new TextEncoder().encode(source));
  const events: BootEvent[] = [];
  const result = await bootGame(assets, event => events.push(event));
  assert.match(result.error?.message ?? '', /missingNext/);
  assert.ok(events.some(event => event.message.includes('GarbageCollector.<init>')));
  assert.ok(events.some(event => event.message.includes('GarbageCollector.push')));
  assert.ok(events.some(event => event.message.includes('GarbageCollector.flush')));
});

test('boot executes a sibling class constructor declared inside GameLogic.java', async () => {
  const initPath = 'sl/scripts/game/src/Init.java';
  const logicPath = 'sl/scripts/game/src/GameLogic.java';
  const sources = new Map([
    [initPath, 'package java.game; class Init extends GameType { Init(int id) { new GameLogic(); } }'],
    [logicPath, 'package java.game; class GameLogic extends GameType { GameLogic() { createNativeInstance(); CareerGoal goal = new CareerGoal(1, "one"); missingNext(); } } class CareerGoal { int flag; CareerGoal(int f, String d) { flag = f; } }'],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })), async path => new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.match(result.error?.message ?? '', /missingNext/);
  assert.doesNotMatch(result.error?.message ?? '', /Java constructor missing: .*CareerGoal/);
});

test('Input controller path reaches GameLogic through java.io.Controller', async () => {
  const initPath = 'sl/scripts/game/src/Init.java';
  const logicPath = 'sl/scripts/game/src/GameLogic.java';
  const sources = new Map([
    [initPath, 'package java.game; import java.io.*; class Init extends GameType { Init(int id) { Input.initControllers(this, "save/controls/active_control_set"); new GameLogic(); } }'],
    [logicPath, `package java.game;
import java.io.*;
class GameLogic extends GameType {
  static String activeControlFile;
  GameLogic() { activeControlFile = Controller.controlFile;
    missingNext();
  }
}`],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })), async path => new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.equal(result.jvm.get({ type: 'class', value: 'java.game.GameLogic' }, 'activeControlFile').value, 'save/controls/active_control_set');
  assert.match(result.error?.message ?? '', /GameLogic\.GameLogic \(source line 6\): Java method\/native missing: java\.game\.GameLogic\.missingNext/);
  assert.match(result.error?.message ?? '', /sl\/scripts\/game\/src\/GameLogic\.java:6\n> missingNext\(\);/);
});

test('boot resolves a class from the same Java package without an import', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', 'package java.game; class Init extends GameType { Init(int id) { new GameLogic(); } }'],
    ['sl/scripts/game/src/GameLogic.java', 'package java.game; class GameLogic extends GameType { GameLogic() { int value = City.MAGIC; missingNext(); } }'],
    ['sl/scripts/game/src/City.java', 'package java.game; class City { static int MAGIC = 17; }'],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })),
    async path => new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.match(result.error?.message ?? '', /GameLogic\.GameLogic .*missingNext/);
  assert.doesNotMatch(result.error?.message ?? '', /Unknown Java name City|Java import unresolved: java\.game\.City/);
});

test('boot resolves Java classes in nested game folders by declared package', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', `package java.game;
      import java.game.parts.bodypart.*;
      class Init extends GameType { Init(int id) {
        FrontSeat seat = new FrontSeat();
        if (seat.value() != 27) wrongClass();
        missingNext();
      } }`],
    ['parts/scripts/bodypart/Src/FrontSeat.java',
      'package java.game.parts.bodypart; class FrontSeat { int value() { return 27; } }'],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })),
    async path => new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.match(result.error?.message ?? '', /missingNext/);
  assert.doesNotMatch(result.error?.message ?? '', /Java import unresolved|wrongClass/);
});

test('boot prefers a system src file over decompiled source and compiled class', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', 'package java.game; class Init extends GameType { Init(int id) { Vector3 center = new Vector3(); missingNext(); } }'],
    ['system/scripts/lang/src/Vector3.java', 'package java.lang; class Vector3 { Vector3() {} }'],
    ['system/scripts/lang/decompiled/Vector3.java', 'package java.lang; class Vector3 { Vector3() { wrongSource(); } }'],
  ]);
  const classPath = 'system/scripts/lang/Vector3.class';
  const files = [...sources].map(([path, source]) => ({ path, size: source.length }));
  files.push({ path: classPath, size: 4 });
  const assets = new Assets(files, async path => path === classPath
    ? new Uint8Array([0, 0, 0, 0]) : new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.match(result.error?.message ?? '', /missingNext/);
  assert.doesNotMatch(result.error?.message ?? '', /TUFA|wrongSource|Java constructor\/native missing: Vector3/);
});

test('boot loads a decompiled system source without using the game src folder', async () => {
  const initPath = 'sl/scripts/game/src/Init.java';
  const decompiledPath = 'system/scripts/lang/decompiled/Vector3.java';
  const classPath = 'system/scripts/lang/Vector3.class';
  const sources = new Map([
    [initPath, 'package java.game; class Init extends GameType { Init(int id) { Vector3 center = new Vector3(); missingNext(); } }'],
    [decompiledPath, 'package java.lang; class Vector3 { Vector3() {} }'],
  ]);
  const files = [...sources].map(([path, source]) => ({ path, size: source.length }));
  files.push({ path: classPath, size: 4 });
  const assets = new Assets(files, async path => path === classPath
    ? new Uint8Array([0, 0, 0, 0]) : new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.match(result.error?.message ?? '', /missingNext/);
  assert.doesNotMatch(result.error?.message ?? '', /TUFA|Java constructor\/native missing: Vector3/);
});

test('boot keeps executable methods from system Java sources', async () => {
  const sources = new Map([
    ['sl/scripts/game/src/Init.java', 'package java.game; class Init extends GameType { Init(int id) { new GameLogic(); } }'],
    ['sl/scripts/game/src/GameLogic.java', 'package java.game; import java.io.*; class GameLogic extends GameType { GameLogic() { if (Input.isPlayerActive(0)) missingNext(); } }'],
    ['system/scripts/io/src/Input.java', 'package java.io; class Input { static int isPlayerActive(int n) { return n == 0; } }'],
  ]);
  const assets = new Assets([...sources].map(([path, source]) => ({ path, size: source.length })),
    async path => new TextEncoder().encode(sources.get(path)!));
  const result = await bootGame(assets, () => {});
  assert.match(result.error?.message ?? '', /missingNext/);
  assert.doesNotMatch(result.error?.message ?? '', /isPlayerActive\(int\)/);
});

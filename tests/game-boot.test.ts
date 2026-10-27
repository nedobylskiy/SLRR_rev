import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assets } from '../src/assets';
import { bootGame, type BootEvent } from '../src/runtime/game-boot';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { SlrrJvm } from 'slrr-jvm';
import { SoundJavaBridge } from '../src/audio/sound-java';
import type { MusicEngine } from '../src/audio/music-engine';

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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assets } from '../src/assets';
import { bootGame, type BootEvent } from '../src/runtime/game-boot';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { SlrrJvm } from 'slrr-jvm';

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
  assert.deepEqual(host.get(vehicle), { id: 1, className: 'java.game.Vehicle', parentId: null, typeId: 0, params: null, alias: 'Vehicle' });
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

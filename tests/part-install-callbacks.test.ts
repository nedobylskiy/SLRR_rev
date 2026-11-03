import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv, type JavaObject } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PartNative } from '../src/runtime/part-native';
import { parsePartConfig } from '../src/formats/cfg';

test('native install reports engine and nested parts through Java addpart/getScriptInstance callbacks', async () => {
  const sources: Record<string, string> = {
    'java.game.parts.Part': `package java.game.parts; import java.util.resource.GameRef;
      class Part extends GameRef {
        Object[] attachedParts = new Object[8]; int count; int installs;
        void addpart(GameRef ref) { attachedParts[count++] = ref.getScriptInstance(); }
        void install() { installs++; }
      }`,
    'java.util.resource.GameRef': `package java.util.resource; class GameRef { native Object getScriptInstance(); }`,
    'java.game.parts.bodypart.Chassis': `package java.game.parts.bodypart;
      import java.game.parts.Part; import java.game.parts.Block;
      class Chassis extends Part {
        int hasEngine() { for (int i = 0; i < count; i++) if (attachedParts[i] instanceof Block) return 1; return 0; }
      }`,
    'java.game.parts.Block': 'package java.game.parts; class Block extends Part {}',
  };
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => sources[className] ? { path: `${className}.java`, source: sources[className] } : null });
  const resources = new GameTypeNative(jvm, () => {});
  const parts = new PartNative(jvm, resources);
  for (const name of Object.keys(sources)) await jvm.loadClass(name);
  const chassis = await jvm.constructAsync('java.game.parts.bodypart.Chassis', []);
  const engine = await jvm.constructAsync('java.game.parts.Block', []);
  const crank = await jvm.constructAsync('java.game.parts.Part', []);
  const root = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', root, []);
  for (const [ref, id] of [[chassis, 1], [engine, 2], [crank, 3]] as const)
    jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', ref,
      [root, jv('int', id), jv('String', null), jv('String', null)]);
  parts.configure(chassis, parsePartConfig('slot 0 0 0 0 0 0 401\nattach 0x2 19'));
  parts.configure(engine, parsePartConfig('slot 0 0 0 0 0 0 19\nslot 0 0 0 0 0 0 40\nattach 0x3 1'));
  parts.configure(crank, parsePartConfig('slot 0 0 0 0 0 0 1'));
  const install = (child: typeof engine, parent: typeof engine) => jvm.natives.invokeAsync('java.util.resource.GameRef', 'queueEvent', child,
    [jv('ResourceRef', null), jv('int', 16), jv('String', `install 0 ${resources.get(chassis)!.resourceId} 0 ${resources.get(parent)!.resourceId} 0`)]);
  assert.equal((await jvm.invokeAsync(chassis, 'hasEngine')).value, 0);
  await install(engine, chassis); await install(crank, engine);
  assert.equal((await jvm.invokeAsync(chassis, 'hasEngine')).value, 1);
  assert.equal(jvm.get(chassis, 'count').value, 2, 'the chassis tracks nested parts too');
  assert.equal(jvm.get(engine, 'installs').value, 1); assert.equal(jvm.get(crank, 'installs').value, 1);
  const refs = jvm.get(chassis, 'attachedParts').value as JavaObject[];
  assert.equal(refs[0], engine.value); assert.equal(refs[1], crank.value);
  await install(engine, chassis);
  assert.equal(jvm.get(chassis, 'count').value, 2, 'a failed/repeated install sends no duplicate callback');
  const alias = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', alias, [jv('ResourceRef', engine.value)]);
  assert.equal(jvm.natives.invoke('java.util.resource.GameRef', 'getScriptInstance', alias, [])!.value, engine.value);
  resources.dispose();
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PartNative } from '../src/runtime/part-native';
import { parsePartConfig } from '../src/formats/cfg';

test('garage assembly edits refresh Java slot locks and allow suspension reinstallation in order', async () => {
  const sources: Record<string, string> = {
    'java.util.resource.GameRef': 'package java.util.resource; class GameRef {}',
    'java.game.parts.Part': `package java.game.parts; import java.util.resource.GameRef;
      class Part extends GameRef {
        native Part partOnSlot(int slot); native void disableSlot(int slot, int status);
      }`,
    'java.game.parts.bodypart.Chassis': `package java.game.parts.bodypart; import java.game.parts.Part;
      class Chassis extends Part {
        void updatevariables() {
          if (partOnSlot(101)) { disableSlot(111,1); disableSlot(311,1); }
          else if (partOnSlot(111)) { disableSlot(111,0); disableSlot(311,1); }
          else { disableSlot(111,0); disableSlot(311,0); }
        }
      }`,
  };
  const jvm = new SlrrJvm({ resolveImport: ({className}) => sources[className]
    ? {path: `${className}.java`, source: sources[className]} : null });
  const resources = new GameTypeNative(jvm, () => {});
  const parts = new PartNative(jvm, resources);
  jvm.natives.registerAsync('java.game.parts.bodypart.Chassis', 'forceUpdate', [], async ({receiver}) => {
    await jvm.invokeAsync(receiver, 'updatevariables'); return jv('void', undefined);
  });
  for (const name of Object.keys(sources)) await jvm.loadClass(name);
  const vehicle = await jvm.constructAsync('java.util.resource.GameRef', []);
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',vehicle,[]);
  const chassis = await jvm.constructAsync('java.game.parts.bodypart.Chassis', []);
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',chassis,[vehicle,jv('int',1),jv('String',null),jv('String',null)]);
  parts.configure(chassis, parsePartConfig([101,111,311].map((slot,i) =>
    `slot 0 0 0 0 0 0 ${slot}\nattach 0x${i+2} 1`).join('\n')));
  const items = [];
  for (const id of [2,3,4]) {
    const part = await jvm.constructAsync('java.game.parts.Part', []);
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',part,[vehicle,jv('int',id),jv('String',null),jv('String',null)]);
    parts.configure(part, parsePartConfig('slot 0 0 0 0 0 0 1'));
    items.push(part);
  }
  const command = (ref: typeof chassis, text: string) => jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',ref,
    [jv('ResourceRef',null),jv('int',16),jv('String',text)]);
  const install = (ref: typeof chassis) => command(ref, `install 0 ${resources.getResource(chassis)!.resourceId}`);
  const remove = (ref: typeof chassis) => command(ref, `remove 0 ${resources.getResource(vehicle)!.resourceId}`);
  const removable = async (ref: typeof chassis) => (await jvm.natives.invokeAsync('java.util.resource.GameRef','getInfo',ref,[jv('int',41),jv('int',0)]))!.value;
  try {
    // Build the stock assembly, then let Java lock the covered mounts.
    for (const part of [...items].reverse()) await install(part);
    await command(vehicle,'wakeup');
    assert.equal(await removable(items[0]),0);
    assert.equal(await removable(items[1]),-1);
    assert.equal(await removable(items[2]),-1);
    for (const part of items) {
      assert.equal(await removable(part),0, 'removing the covering part must unlock the next mount');
      await remove(part);
      assert.equal(await removable(part),-1, 'inventory parts are no longer mounted');
      await command(vehicle,'wakeup');
    }
    assert.equal(parts.installedTree(chassis).length,0);
    for (const part of [...items].reverse()) {
      await install(part);
      assert.equal(resources.getResource(part)!.parent,resources.getResource(chassis));
      await command(vehicle,'reset');
    }
    assert.equal(parts.installedTree(chassis).length,3);
    assert.equal(await removable(items[2]),-1, 'reassembled wheel covers the spring again');
  } finally { resources.dispose(); }
});



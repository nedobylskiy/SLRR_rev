import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { groundRenderDefinition } from '../src/engine/map';
import type { RpkEntry } from '../src/formats/rpk';
import { activeJavaTrack } from '../src/runtime/java-scene';
import { GameTypeNative } from '../src/runtime/game-type-native';
import type { BootResult } from '../src/runtime/game-boot';

test('compiled GroundRef RSD chooses its own room mesh and pose, not all rooms in the pack', () => {
  for (const [id, renderId] of [[0x7a, 5], [6, 11], [0xc7, 40], [0x2f, 73]]) {
    const text = new TextEncoder().encode(`gametype 0x00010035\r\nparams 0x${renderId.toString(16)},1,2,3,0.5,0,0\r\n`);
    const data = new Uint8Array(21 + 8 + text.length);
    data.set([82, 83, 68, 0], 21); new DataView(data.buffer).setUint32(25, text.length, true); data.set(text, 29);
    const entry: RpkEntry = { superId: 0, typeId: id, type: 1, flags: 0, compatibility: 1, offset: 0, size: data.length, alias: 'room', data };
    assert.deepEqual(groundRenderDefinition(entry), { gameType: 0x10035, renderId,
      pose: { position: [1, 2, 3], rotation: [0.5, 0, 0] } });
    assert.equal(groundRenderDefinition({ ...entry, type: 14 }), undefined);
    assert.equal(groundRenderDefinition({ ...entry, data: data.slice(0, -1) }), undefined, 'do not decode a truncated RSD tail');
  }
});

test('Java scene discovery loads an empty map while still waiting for an existing car to attach', async () => {
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'java.game.GameLogic'
    ? { path: 'GameLogic.java', source: 'package java.game; class GameLogic { static Object actualState; static Object player; }' } : null });
  await jvm.loadClass('java.game.GameLogic');
  await jvm.globalAsync('java.game.GameLogic');
  const resources = new GameTypeNative(jvm, () => {});
  const object = (className: string, fields: Record<string, JavaValue> = {}) => jv(className.split('.').at(-1)!, { className, fields: new Map(Object.entries(fields)) });
  const map = object('java.util.resource.GroundRef'), id = jv('int', 0x6007a); id.resource = { pack: 'misc.garage', id: 0x7a };
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', map, [id]);
  const state = object('java.game.Garage', { map }), player = object('java.game.Player', { car: jv('Vehicle', null) });
  jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', state); jvm.set(jv('class', 'java.game.GameLogic'), 'player', player);
  const result = { jvm, gameTypes: resources, resolveResourceIdentity: () => undefined } as unknown as BootResult;
  const empty = activeJavaTrack(result)!;
  assert.equal(empty.ready, true); assert.equal(empty.carPose, undefined);
  assert.equal(empty.mapPack, 'misc/garage.rpk'); assert.equal(empty.mapResourceId, 0x7a);
  const car = object('java.game.Vehicle', { chassis: jv('Chassis', null) }); jvm.set(player, 'car', car);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', car, []);
  assert.equal(activeJavaTrack(result)!.ready, false);
  resources.get(car)!.setParent(resources.getResource(map)!);
  assert.equal(activeJavaTrack(result)!.ready, true);
  assert.deepEqual(activeJavaTrack(result)!.carPose, { x: 0, y: 0, z: 0, yaw: 0 });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PartNative } from '../src/runtime/part-native';

test('Vehicle.getPrestige on a rival dummycar uses the Bot descriptor instead of a missing GameRef native', async () => {
  // Mirrors the original scripts: Bot.getPrestigeString -> Vehicle.getPrestige -> chassis.currentPrestige().
  // City.selectNrOpponent crashed on this for speedymen whose car wraps a create_native dummycar.
  const sources: Record<string, string> = {
    'java.game.GameLogic': 'package java.game; class GameLogic { static Racer[] speedymen; }',
    'java.game.Racer': 'package java.game; class Racer {}',
    'java.game.Bot': `package java.game;
      class Bot extends Racer { java.util.resource.GameRef dummycar; Vehicle car; VehicleDescriptor botVd; VehicleDescriptor nightVd; }`,
    'java.game.VehicleDescriptor': `package java.game;
      class VehicleDescriptor { int id; float power; float optical; float stockPrestige; float fullPrestige;
        float estimatePrestige() {
          float p = ((power - 1.0) + (optical - 1.0)) * 0.5;
          if (p < 0.0) p = stockPrestige * (1.0 - p); else p = stockPrestige + (fullPrestige - stockPrestige) * p;
          return p * 0.01;
        } }`,
    'java.game.Vehicle': `package java.game;
      class Vehicle { java.util.resource.GameRef chassis; int races_won; int races_lost;
        float getPrestige() { if (!chassis) return 0.0; return chassis.currentPrestige(); } }`,
  };
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => sources[className] ? { path: `${className}.java`, source: sources[className] } : null });
  for (const name of Object.keys(sources)) await jvm.loadClass(name);
  await jvm.globalAsync('java.game.GameLogic');
  const types = new GameTypeNative(jvm, () => {});
  new PartNative(jvm, types);
  const object = (className: string, fields: Record<string, JavaValue> = {}) =>
    jv(className.split('.').at(-1)!, { className, fields: new Map(Object.entries(fields)) });
  const map = object('java.util.resource.GroundRef'); jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', map, []);
  const native = (typeId: number) => {
    const car = object('java.util.resource.GameRef');
    jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', car, [jv('GameRef', map.value), jv('int', typeId), jv('String', null), jv('String', 'dummycar')]);
    return car;
  };
  const descriptor = (id: number, stock: number) => object('java.game.VehicleDescriptor', { id: jv('int', id), power: jv('float', 1),
    optical: jv('float', 1), stockPrestige: jv('float', stock), fullPrestige: jv('float', stock * 2) });
  const dummycar = native(6), loose = native(9);
  const vehicle = object('java.game.Vehicle', { chassis: dummycar, races_won: jv('int', 0), races_lost: jv('int', 0) });
  const bot = object('java.game.Bot', { dummycar, car: vehicle, botVd: descriptor(6, 80), nightVd: descriptor(0x112, 300) });
  jvm.set(jv('class', 'java.game.GameLogic'), 'speedymen', jv('Racer[]', [bot.value]));
  const prestige = async (car: JavaValue) => Number((await jvm.invokeAsync(
    object('java.game.Vehicle', { chassis: car, races_won: jv('int', 0), races_lost: jv('int', 0) }), 'getPrestige')).value);
  assert.ok(Math.abs(await prestige(dummycar) - 0.8) < 1e-6, 'the dummycar is built from botVd, so its prestige is botVd.estimatePrestige()');
  assert.equal(await prestige(loose), 0, 'an unknown native car has no parts to rate');
  types.dispose();
});

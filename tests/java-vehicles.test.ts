import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv, SlrrJvm, type JavaObject, type JavaValue } from 'slrr-jvm';
import { JavaSceneVehicles } from '../src/render/java-vehicles';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { GameObject } from '../src/runtime/game-object';
import type { BootResult } from '../src/runtime/game-boot';
import type { Assets } from '../src/assets';
import { EngineWorld, type PartFactory } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { javaStockSelection } from '../src/runtime/java-scene';
import { createWheelRefState } from '../src/runtime/wheel-ref-native';

test('scene vehicles use each Java chassis, follow poses and release removed or pending models', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'GameLogic.java',
    source: 'package java.game; class GameLogic { static Object actualState; static Object player; }' }) });
  await jvm.loadClass('java.game.GameLogic'); await jvm.globalAsync('java.game.GameLogic');
  const gameTypes = new GameTypeNative(jvm, () => {});
  const ref = (name: string) => jv(name, { className: name, fields: new Map<string, JavaValue>() });
  const map = ref('java.util.resource.GroundRef');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', map, []);
  const vehicles = [1, 2].map(id => {
    const car = ref('java.game.Vehicle'), chassis = ref('java.game.parts.bodypart.Chassis');
    jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', car, [jv('GameRef', map.value), jv('int', 0), jv('String', null), jv('String', null)]);
    jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', chassis, [jv('GameRef', car.value), jv('int', id), jv('String', null), jv('String', null)]);
    gameTypes.getResource(chassis)!.resourcePack = 'cars/test.rpk';
    (car.value as JavaObject).fields.set('chassis', chassis);
    for (const name of ['E', 'FL', 'FR', 'RL', 'RR', 'F', 'Rr', 'L', 'R', 'T'])
      (chassis.value as JavaObject).fields.set(`parts_list_${name}`, jv('int[]', []));
    for (const name of ['suspensions', 'shocks', 'springs', 'brakes', 'sways', 'wheels', 'others', 'tyres'])
      (chassis.value as JavaObject).fields.set(`parts_list_RGear_${name}`, jv('int[]', []));
    const node = gameTypes.get(car)!;
    node.setMatrix({ x: id * 10, y: 1, z: 0 }, { y: 0, p: 0, r: 0 });
    return { car, chassis, node };
  });
  const result = { jvm, gameTypes, resolveResourceIdentity: () => undefined,
    parts: { installedTree: () => [], slotOverrides: () => new Map(), engineDyno: () => undefined },
    chassis: { wheelState: () => undefined, updateState: () => undefined, coolingSettings: () => [10,50,0.01] } } as unknown as BootResult;
  // Driving and display projections must both accept loaded cars with empty stock
  // recipes, without inventing replacements for missing installed components.
  const loadedSelection = await javaStockSelection(result, {} as Assets, 'cars/test.rpk', vehicles[0].car);
  assert.deepEqual(loadedSelection.installed, []);
  assert.deepEqual(loadedSelection.mechanical, []);
  assert.equal(loadedSelection.wheelRefs.length, 4);
  const state = ref('java.game.CarMarket');
  (state.value as JavaObject).fields.set('curcar', jv('int', 0));
  (state.value as JavaObject).fields.set('cars', jv('Vehicle[]', vehicles.map(vehicle => vehicle.car.value)));
  jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', state);
  // Match the real Vehicle.create() alias: the native tree exposes the chassis
  // while the Java section retains the Vehicle wrappers in its stock array.
  const reference = gameTypes.reference.bind(gameTypes);
  gameTypes.reference = node => vehicles.find(vehicle => vehicle.node === node)?.chassis ?? reference(node);
  const shown: EngineWorld[] = [], removed: EngineWorld[] = [], built: Awaited<ReturnType<PartFactory['stock']>>[] = [];
  let visualSyncs = 0;
  let finishShow: (() => void) | undefined;
  const calibration = { value: undefined as number | undefined };
  const renderer = new JavaSceneVehicles(result, {} as Assets, {
    get calibrationSteering() { return calibration.value; },
    showWorld: async world => { shown.push(world); if (shown.length === 2) await new Promise<void>(resolve => { finishShow = resolve; }); return []; },
    removeWorld: world => { removed.push(world); }, syncWorldVisuals: () => { visualSyncs++; },
  }, message => assert.fail(message), {
    syncJavaAssembly: async () => { assert.fail('unchanged vehicles must not refresh their assemblies'); },
    stock: async (key, options) => {
      assert.ok(options?.javaSelection, 'use installed Java tree even for incomplete cars');
      const world = new EngineWorld();
      const config = parsePartConfig('category 2\nslot 0 0 0 0 0 0 101\nslottype 101');
      config.wheels.push({ position: [0, -0.4, 0], rotation: [0, 0, 0], radius: 0.3, parameters: [] });
      const root = world.create({ key, alias: 'test', cfgPath: 'test.cfg', config });
      const wheel = world.create({ key, alias: 'wheel', cfgPath: 'wheel.cfg', config: parsePartConfig('category 3\nslot 0 0 0 0 0 0 1') });
      const wheelRef = ref('java.game.parts.Part');
      jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', wheelRef, []);
      wheel.nativeId = gameTypes.getResource(wheelRef)!.resourceId;
      world.install(root, 101, wheel, 1);
      config.wheels[0].parameters = [1];
      world.create({ key, alias: 'engine', cfgPath: 'engine.cfg', config: parsePartConfig('category 1') });
      const model = { world, root, warnings: [] as string[] }; built.push(model); return model;
    },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  renderer.update(map); await settle();
  assert.equal(shown.length, 1); assert.equal(built[0].root.definition.key.id, 1);
  assert.equal(built[0].root.local.elements[12], 10);
  assert.deepEqual(gameTypes.getByResourceId(built[0].root.children.get(101)!.nativeId!) instanceof GameObject, true);
  assert.deepEqual((gameTypes.getByResourceId(built[0].root.children.get(101)!.nativeId!) as GameObject).position,
    { x: 10, y: 0.6, z: 0 }, 'installed native part pose is available to the Java camera look command');
  const filter = async (category: number, mode: number) => {
    await jvm.natives.invokeAsync('java.util.resource.GameRef', 'queueEvent', vehicles[0].car,
      [jv('ResourceRef', null), jv('int', 16), jv('String', `filter ${category} ${mode}`)]);
    renderer.update(map);
  };
  await filter(2, 2);
  assert.equal(built[0].root.renderVisible, false);
  assert.equal(built[0].root.children.get(101)!.renderVisible, true);
  await filter(3, 2);
  assert.equal(built[0].root.children.get(101)!.renderVisible, false);
  assert.equal([...built[0].world.parts.values()].find(part => part.definition.alias === 'engine')!.renderVisible, true);
  await filter(2, 0);
  assert.equal(built[0].root.renderVisible, true);
  assert.equal(built[0].root.children.get(101)!.renderVisible, false, 'each category retains its own filter');
  await filter(3, 0);
  const steer = async (value: string) => {
    await jvm.natives.invokeAsync('java.util.resource.GameRef', 'queueEvent', vehicles[0].car,
      [jv('ResourceRef', null), jv('int', 16), jv('String', `setsteer ${value}`)]);
    renderer.update(map);
  };
  const wheel = built[0].root.children.get(101)!;
  await steer('-0.7');
  assert.equal(vehicles[0].node.steeringInput, -0.7);
  assert.ok(Math.abs(wheel.local.elements[8]) > 0.1, 'Java command turns the displayed wheel');
  const turned = wheel.local.clone();
  const beforeIdle = visualSyncs;
  renderer.update(map);
  assert.equal(visualSyncs, beforeIdle, 'unchanged cars skip visual and native transform publication');
  assert.deepEqual(wheel.local, turned, 'display updates must not accumulate steering');
  await steer('0');
  assert.equal(wheel.local.elements[8], 0, 'setsteer 0 restores the neutral slot frame');
  calibration.value = 0.5;
  renderer.update(map);
  assert.ok(wheel.local.elements[8] > 0.1, 'garage alignment slider turns the vehicle wheels');
  assert.equal(vehicles[0].node.steeringInput, 0, 'alignment does not replace the script steering value');
  calibration.value = undefined;
  renderer.update(map);
  assert.equal(wheel.local.elements[8], 0, 'clearing the override restores Java steering');
  await steer('2');
  assert.equal(vehicles[0].node.steeringInput, 1);
  await assert.rejects(() => steer('NaN'), /Invalid steering command/);
  await steer('0');
  renderer.update(map, { height: () => 2 }); await settle();
  assert.ok(Math.abs(built[0].root.local.elements[13] - 2.7) < 1e-9, 'static wheel contact resolves floor penetration');
  renderer.update(map, { height: () => 5 });
  assert.ok(Math.abs(built[0].root.local.elements[13] - 2.7) < 1e-9, 'a settled car must not ratchet up to furniture or ceilings');
  built[0].root.definition.config.wheels[0].position[1]-=.1;
  renderer.update(map,{height:()=>2});
  assert.ok(Math.abs(built[0].root.local.elements[13]-2.8)<1e-9,'changed suspension contact geometry invalidates parked floor contact even without a pose command');
  const chassisNode = gameTypes.get(vehicles[0].chassis)!;
  assert.ok(chassisNode instanceof GameObject);
  chassisNode.setState({ x: 15, y: 2, z: 3 }, { y: 0, p: 0, r: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  renderer.update(map, { height: () => 2 }); await settle();
  assert.equal(built[0].root.local.elements[12], 15);
  assert.equal(built[1].root.definition.key.id, 2);
  const stableSyncs = visualSyncs;
  renderer.update(map, { height: () => 2 });
  assert.equal(visualSyncs, stableSyncs, 'all loaded parked cars can sleep after settling');
  const gear = built[0].root.children.get(101)!;
  let attachmentReads = 0;
  const slotFrame = built[0].root.slotFrame.bind(built[0].root);
  built[0].root.slotFrame = slot => { attachmentReads++; return slotFrame(slot); };
  chassisNode.setState({ x: 16, y: 2, z: 3 }, { y: 0.2, p: 0, r: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  renderer.update(map, { height: () => 2 });
  assert.equal(visualSyncs, stableSyncs + 1, 'moving one car does not resynchronize the other cars');
  assert.equal(attachmentReads, 0, 'rigid chassis motion reuses the loaded suspension pose');
  const nativeWheel = gameTypes.getByResourceId(gear.nativeId!) as GameObject;
  assert.ok(nativeWheel.position.x > 15, 'moving cars still publish camera attachment positions');
  assert.equal(built[0].root.local.elements[12], 16);
  const lateWheel = createWheelRefState();
  result.chassis.wheelState = (_chassis, index) => index === 0 ? lateWheel : undefined;
  const beforeWheelBinding = visualSyncs;
  renderer.update(map, { height: () => 2 });
  assert.ok(visualSyncs > beforeWheelBinding, 'late WheelRef bindings wake sleeping displays');
  const beforeRadiusChange = visualSyncs;
  lateWheel.radius += 0.1;
  renderer.update(map, { height: () => 2 });
  assert.ok(visualSyncs > beforeRadiusChange, 'in-place WheelRef tuning wakes sleeping displays');
  renderer.update(null); finishShow!(); await settle();
  assert.equal(removed.length, 2);
  assert.ok(built.every(model => model.world.disposed));
  renderer.dispose(); assert.equal(removed.length, 2);
});




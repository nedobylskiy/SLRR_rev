import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv, SlrrJvm, type JavaObject, type JavaValue } from 'slrr-jvm';
import { JavaSceneVehicles } from '../src/render/java-vehicles';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { GameObject } from '../src/runtime/game-object';
import type { BootResult } from '../src/runtime/game-boot';
import type { Assets } from '../src/assets';
import { EngineWorld, PartFactory } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { javaStockSelection } from '../src/runtime/java-scene';
import { createWheelRefState } from '../src/runtime/wheel-ref-native';
import type {JavaRaceControl} from '../src/engine/race-driver';
import {Vector3} from 'three';

test('native fake racers and ParkingCar.gr render once without scripted Part fields', async () => {
  const jvm = new SlrrJvm({resolveImport: () => ({path:'GameLogic.java', source:
    'package java.game; class GameLogic { static Object actualState; static Object player; }'})});
  await jvm.loadClass('java.game.GameLogic'); await jvm.globalAsync('java.game.GameLogic');
  const types = new GameTypeNative(jvm, () => {});
  const ref = (name:string, fields:Record<string,JavaValue>={}) => jv(name,{className:name,fields:new Map(Object.entries(fields))});
  const map = ref('GroundRef'); jvm.natives.invoke('java.lang.GameType','createNativeInstance',map,[]);
  const fake = (id:number) => {
    const car = ref('java.util.resource.GameRef');
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',car,[jv('GameRef',map.value),jv('int',id),jv('String',null),jv('String','fake')]);
    types.getResource(car)!.resourcePack='cars/fake_racers/Ninja.rpk'; return car;
  };
  const parked=fake(1), racer=fake(2), player=fake(3), traffic=fake(4);
  types.catalogResource=(_pack,id)=>({nativeType:'car',id}) as ReturnType<GameTypeNative['catalogResource']>;
  const vehicle=ref('java.game.Vehicle',{chassis:racer});
  jvm.natives.invoke('java.util.resource.ResourceRef','set',vehicle,[jv('ResourceRef',racer.value)]);
  const brain=ref('GameRef');jvm.natives.invoke('java.lang.GameType','createNativeInstance',brain,[]);
  const driver=types.createRender(ref('RenderRef'),map,null,'botfigura')!;
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',brain,[jv('ResourceRef',null),jv('int',16),jv('String',`renderinstance ${driver.resourceId}`)]);
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',brain,[jv('ResourceRef',null),jv('int',16),jv('String','AI_race 100,0,200 123')]);
  const state=ref('City',{parkingCars:jv('ParkingCar[]',[ref('ParkingCar',{gr:parked}).value]),
    nrBot1:ref('Bot',{car:vehicle,brain})});
  jvm.set(jv('class','java.game.GameLogic'),'actualState',state);
  jvm.set(jv('class','java.game.GameLogic'),'player',ref('Player',{car:player}));
  const result={jvm,gameTypes:types,resolveResourceIdentity:()=>undefined,
    parts:{visualRevision:()=>0,installedTree:()=>[],slotOverrides:()=>new Map()},
    chassis:{wheelState:()=>undefined,updateState:()=>undefined}} as unknown as BootResult;
  const selection=await javaStockSelection(result,{} as Assets,'cars/fake_racers/Ninja.rpk',vehicle);
  assert.equal(selection.nativeOnly,true); assert.equal(selection.powertrain,undefined);
  assert.deepEqual(selection.installed,[]);
  const shown:EngineWorld[]=[];let control:JavaRaceControl|undefined;const bindings:JavaRaceControl[]=[];
  const factory=new PartFactory({} as Assets);
  factory.definition=async key=>({key,alias:'fake',cfgPath:'fake.cfg',config:parsePartConfig(`category 2
type 10 sphere .33
wheel -.67 -.634 -1.2 0 0 0 1 1 1 0
wheel .67 -.634 -1.2 0 0 0 1 1 1 0
wheel -.67 -.634 1.2 0 0 0 0 1 1 0
wheel .67 -.634 1.2 0 0 0 0 1 1 0`)});
  const renderer=new JavaSceneVehicles(result,{} as Assets,{
    showWorld:async world=>{shown.push(world);return [];},removeWorld:()=>{},syncWorldVisuals:()=>{},
    bindJavaDriver:async()=>assert.fail('native fake racer has no modular steering wheel for IK'),
    bindJavaRaceCar:async(_root,commands)=>{control=commands;bindings.push(commands);return {dispose(){}};},
  },message=>assert.fail(message),{syncJavaAssembly:async()=>assert.fail('unchanged native model'),stock:async(key,options)=>{
    assert.equal(options?.javaSelection?.nativeOnly,true);
    return factory.stock(key,options);
  }});
  const terrain={height:()=>10};
  types.get(parked)!.setMatrix({x:0,y:14,z:0},{y:0,p:0,r:0});
  await renderer.prepare(map,terrain,car=>[player,traffic].some(other=>types.get(other)===types.get(car)));
  assert.equal(shown.length,2,'both parked car and bot car, without duplicate aliases or player/traffic');
  for(const car of [parked,racer])assert.ok(Math.abs(types.get(car)!.position.y-10.964)<1e-6,'inline tires sit on the road');
  assert.equal(control!.command(),'AI_race 100,0,200 123 AI_NightRace','background night racers also use straight-line drag control');
  assert.equal(control!.active(),true);
  assert.equal(bindings.length,2,'parked native car also receives a collision binding');
  assert.equal(bindings.filter(binding=>binding.parked).length,1,'only the spectator car starts asleep without a driver');
  renderer.update(map,terrain,car=>[player,traffic].some(other=>types.get(other)===types.get(car)));
  assert.equal(shown.length,2,'unchanged models remain resident');
  renderer.dispose(); types.dispose();
});

test('a Bot-owned race car is prepared before scene readiness without duplicating player or streamed traffic',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>({path:'GameLogic.java',source:'package java.game; class GameLogic { static Object actualState; static Object player; }'})});
  await jvm.loadClass('java.game.GameLogic');await jvm.globalAsync('java.game.GameLogic');
  const types=new GameTypeNative(jvm,()=>{}),ref=(name:string,fields:Record<string,JavaValue>={})=>jv(name,{className:name,fields:new Map(Object.entries(fields))});
  const map=ref('GroundRef');jvm.natives.invoke('java.lang.GameType','createNativeInstance',map,[]);
  const cars=[1,2,3].map(id=>{
    const car=ref('java.game.Vehicle'),chassis=ref('Chassis');
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',car,[jv('GameRef',map.value),jv('int',0),jv('String',null),jv('String',null)]);
    jvm.natives.invoke('java.lang.GameType','createNativeInstance',chassis,[jv('GameRef',car.value),jv('int',id),jv('String',null),jv('String',null)]);
    types.getResource(chassis)!.resourcePack='cars/test.rpk';(car.value as JavaObject).fields.set('chassis',chassis);
    for(const name of ['E','FL','FR','RL','RR','F','Rr','L','R','T'])(chassis.value as JavaObject).fields.set(`parts_list_${name}`,jv('int[]',[]));
    for(const name of ['suspensions','shocks','springs','brakes','sways','wheels','others','tyres'])(chassis.value as JavaObject).fields.set(`parts_list_RGear_${name}`,jv('int[]',[]));
    return {car,chassis};
  });
  const brain=ref('GameRef');jvm.natives.invoke('java.lang.GameType','createNativeInstance',brain,[]);
  const driver=types.createRender(ref('RenderRef'),map,null,'botfigura')!;
  const command=async(text:string)=>jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',brain,[jv('ResourceRef',null),jv('int',16),jv('String',text)]);
  await command(`renderinstance ${driver.resourceId}`);await command('AI_suspend');
  const state=ref('City',{unusedBot:ref('Bot',{car:jv('Vehicle',null)}),raceBot:ref('Bot',{car:cars[1].car,brain})});
  jvm.set(jv('class','java.game.GameLogic'),'actualState',state);
  jvm.set(jv('class','java.game.GameLogic'),'player',ref('Player',{car:cars[0].car}));
  const reference=types.reference.bind(types);types.reference=node=>cars.find(c=>types.get(c.car)===node)?.chassis??reference(node);
  const result={jvm,gameTypes:types,resolveResourceIdentity:()=>undefined,
    parts:{visualRevision:()=>0,installedTree:()=>[],slotOverrides:()=>new Map(),engineDyno:()=>undefined},
    chassis:{wheelState:()=>undefined,updateState:()=>undefined,coolingSettings:()=>[10,50,.01]}} as unknown as BootResult;
  const shown:EngineWorld[]=[];let finish!:()=>void,ready=false,seated=false,released=false,sceneRevision=0,control:JavaRaceControl|undefined;
  const renderer=new JavaSceneVehicles(result,{} as Assets,{
    showWorld:async world=>{shown.push(world);await new Promise<void>(resolve=>{finish=resolve;});return [];},
    removeWorld:()=>{},syncWorldVisuals:()=>{},
    get vehicleSceneRevision(){return sceneRevision;},
    bindJavaDriver:async(node,root)=>{assert.equal(node,driver);assert.equal(root.world,shown.at(-1));seated=true;},
    bindJavaRaceCar:async(root,commands)=>{assert.equal(seated,true,'seat the original Java driver before releasing scene readiness');control=commands;return {dispose(){released=true;}};}
  },message=>assert.fail(message),{syncJavaAssembly:async()=>assert.fail('unchanged race car must reuse its assembly'),stock:async key=>{
    assert.equal(key.id,2,'select Bot.car rather than building another player/traffic car');
    const world=new EngineWorld(),root=world.create({key,alias:'racer',cfgPath:'test.cfg',config:parsePartConfig('category 2')});return {world,root,warnings:[]};
  }} as Pick<PartFactory,'stock'|'syncJavaAssembly'>);
  const excluded=(car:JavaValue)=>cars.filter((_,i)=>i!==1).some(c=>types.get(c.car)===types.get(car));
  const work=renderer.prepare(map,undefined,excluded).then(()=>{ready=true;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ready,false,'race readiness waits for the opponent mesh');assert.equal(shown.length,1);
  finish();await work;assert.equal(ready,true);
  assert.equal(seated,true);assert.equal(control!.command(),'AI_suspend');assert.equal(control!.active(),true);
  assert.ok(control!.placement!());assert.equal(control!.placement!(),undefined);
  await command('AI_race 100,0,200 123');assert.equal(control!.command(),'AI_race 100,0,200 123');
  control!.motion(new Vector3(12,3,45),.7,new Vector3(1,0,2));assert.deepEqual(types.get(cars[1].car)!.position,{x:12,y:3,z:45});
  assert.equal(control!.placement!(),undefined,'physics publication must not teleport itself every frame');
  types.get(cars[1].car)!.setMatrix({x:300,y:4,z:500},{y:1,p:0,r:0});
  assert.deepEqual(control!.placement!()!.position.toArray(),[300,4,500],'late Java start-line placement reaches the physics');
  assert.equal(control!.placement!(),undefined);
  renderer.update(map,undefined,excluded);assert.equal(shown.length,1,'unchanged opponent is reused');
  const oldControl=control!;sceneRevision++;
  const restart=renderer.prepare(map,undefined,excluded);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(shown.length,2,'second quick race recreates a model removed by viewer.clear even with the same Java car');
  assert.equal(shown[0].disposed,true);assert.equal(oldControl.active(),false,'old physics cannot publish into the new race');
  finish();await restart;
  assert.notEqual(control,oldControl);assert.equal(control!.active(),true);assert.equal(shown[1].disposed,false);
  const replacement=ref('GameRef');jvm.natives.invoke('java.lang.GameType','createNativeInstance',replacement,[]);
  await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',replacement,[jv('ResourceRef',null),jv('int',16),jv('String',`renderinstance ${driver.resourceId}`)]);
  ((state.value as JavaObject).fields.get('raceBot')!.value as JavaObject).fields.set('brain',replacement);
  const rebind=renderer.prepare(map,undefined,excluded);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(shown.length,3,'a replacement Java brain on the same car also replaces its physics binding');
  finish();await rebind;assert.equal(shown[1].disposed,true);assert.equal(control!.active(),true);
  (state.value as JavaObject).fields.set('raceBot',jv('Bot',null));renderer.update(map,undefined,excluded);
  assert.equal(shown[2].disposed,true,'remove the opponent when Java releases the Bot');assert.equal(released,true);assert.equal(control!.active(),false);renderer.dispose();types.dispose();
});

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
  let treeReads = 0;
  const result = { jvm, gameTypes, resolveResourceIdentity: () => undefined,
    parts: { visualRevision: (receiver: JavaValue) => gameTypes.getResource(receiver)?.visualRevision ?? 0, installedTree: () => { treeReads++; return []; }, slotOverrides: () => new Map(), engineDyno: () => undefined },
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
  const readsBeforeIdle = treeReads;
  const parts = built[0].world.parts;
  const values = parts.values;
  let partWalks = 0;
  parts.values = function () { partWalks++; return values.call(this); };
  for (let i = 0; i < 100; i++) renderer.update(map);
  assert.equal(treeReads, readsBeforeIdle, 'idle display polls must not rebuild native installed trees');
  assert.equal(partWalks, 0, 'idle display polls must not traverse the host parts to build geometry signatures');
  parts.values = values;
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

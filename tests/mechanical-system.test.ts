import test from 'node:test';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { MechanicalSystem } from '../src/engine/mechanical-system';
import { OriginalStock, originalNumber, selectStockBranches, type MechanicalProfile } from '../src/engine/original-stock';
import { parsePartConfig } from '../src/formats/cfg';

test('original numeric units and conditional stock selection stay bounded and literal', () => {
  assert.equal(originalNumber('kgfPmm2NPm(7.3)'), 71613);
  assert.equal(originalNumber('Inch2Meter(8.5)'), 0.21589999999999998);
  assert.equal(originalNumber('240.0-58.0'), 182);
  assert.equal(originalNumber('process.exit(1)'), undefined);
  assert.equal(selectStockBranches('if(desc.power < 1.3) { addPart(low); } else { addPart(high); }', { 'desc.power': 1 }), ' addPart(low); ');
  assert.deepEqual(parsePartConfig('render 0x70 0 -0.245662 0').renderPose?.rotation, [0, 0, 0]);
});

test('brake profile reads the original corner-specific render IDs', async () => {
  const path = 'parts/running_gear/scripts/brakes/src/sample.java';
  const source = 'public class sample extends DiscBrake { renderID_FL = parts:0xA1r; renderID_FR = parts:0xC1r; renderID_RL = parts:0xC3r; renderID_RR = parts:0xC5r; }';
  const assets = new Assets([{ path, size: source.length }], async () => new TextEncoder().encode(source));
  const definition: PartDefinition = { key: { pack: 'parts.rpk', id: 1 }, alias: 'sample', cfgPath: 'disc_brake.cfg', script: 'parts/running_gear/scripts/brakes/sample.class', config: parsePartConfig('slot 0 0 0 0 0 0 1') };
  assert.deepEqual((await new OriginalStock(assets).profile(definition))?.renderVariants, {
    FL: { pack: 'parts.rpk', id: 0xa1 }, FR: { pack: 'parts.rpk', id: 0xc1 },
    RL: { pack: 'parts.rpk', id: 0xc3 }, RR: { pack: 'parts.rpk', id: 0xc5 },
  });
});

test('suspension profile reads native wheel and brake slot positions without executing Java', async () => {
  const path = 'parts/running_gear/scripts/fl_susp/src/sample.java';
  const source = 'public class sample extends Suspension { void updatevariables() { the_car.setSlotPos(101+wheelID, new Vector3(-0.124,0,0), null); the_car.setSlotPos(111+wheelID, new Vector3(-0.113,0,0), null); } }';
  const assets = new Assets([{ path, size: source.length }], async () => new TextEncoder().encode(source));
  const definition: PartDefinition = { key: { pack: 'parts.rpk', id: 1 }, alias: 'sample', cfgPath: 'fl_strut.cfg', script: 'parts/running_gear/scripts/fl_susp/sample.class', config: parsePartConfig('slot 0 0 0 0 0 0 1') };
  assert.deepEqual((await new OriginalStock(assets).profile(definition))?.slotPositions, [
    { base: 101, position: [-0.124, 0, 0] }, { base: 111, position: [-0.113, 0, 0] },
  ]);
});

test('installed original component condition changes support, damping, braking and delivered torque', () => {
  const world = new EngineWorld(); world.mechanical = true;
  const def = (id: number, kind?: MechanicalProfile['kind'], values: Record<string, number> = {}, drive?: string): PartDefinition => ({
    key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`,
    config: parsePartConfig('slot 0 0 0 0 0 0 1'), mechanics: kind ? { kind, source: `${id}.java`, values, drive } : undefined,
  });
  const root = world.create(def(1));
  for (const id of [123, 313, 303, 113, 702, 401, 402, 403, 404, 405, 406]) root.definition.config.slots.push({ id, position: [0, 0, 0], rotation: [0, 0, 0], attach: [], compatible: [] });
  const add = (id: number, slot: number, kind: MechanicalProfile['kind'], values: Record<string, number> = {}, drive?: string) => {
    const p = world.create(def(id, kind, values, drive)); world.install(root, slot, p, 1); return p;
  };
  const strut = add(2, 123, 'suspension'), spring = add(3, 313, 'spring', { force: 73575 }), shock = add(4, 303, 'shock', { damping: 3000 }), brake = add(5, 113, 'brake');
  const sway = add(12, 702, 'sway', { force: 10000, damping: 1300 });
  const block = add(6, 401, 'engine', { cylinders: 6, bore: 80, rpm_idle: 1000, RPM_limit: 7000 });
  const crank = add(7, 402, 'engine', { stroke: 90 });
  add(8, 403, 'engine', { intake_valve_diam: 31 });
  const transmission = add(9, 404, 'engine', { gears: 5, 'ratio[1]': 3.58, end_ratio: 3.03 }, 'DT_RWD');
  const clutch = add(10, 405, 'engine'); clutch.definition.script = 'clutch.java';
  const fuel = add(11, 406, 'engine'); fuel.definition.script = 'fuel_rail.java';
  const system = new MechanicalSystem(root), nominal = system.driveForce(2, 0, 0.315, 1);
  assert.equal(system.spring(2), 73575); assert.equal(system.damper(2), 3000); assert.equal(system.brake(2), 1);
  assert.deepEqual(system.sway(2), { force: 10000, damping: 1300 });
  assert.ok(nominal > 2000 && nominal < 4000); assert.equal(system.driveForce(0, 0, 0.315, 1), 0);
  spring.condition = 0.5; shock.condition = 0.4; brake.condition = 0.3; sway.condition = 0.2;
  assert.equal(system.spring(2), 73575 * 0.5); assert.equal(system.damper(2), 1200); assert.equal(system.brake(2), 0.3);
  assert.deepEqual(system.sway(2), { force: 2000, damping: 260 });
  crank.condition = 0.4; assert.ok(Math.abs(system.driveForce(2, 0, 0.315, 1) / nominal - 0.4) < 1e-12);
  strut.condition = 0.09; assert.equal(system.support(2), 0.09);
  world.detach(transmission); assert.equal(system.driveForce(2, 0, 0.315, 1), 0); assert.equal(system.power, 0);
  world.install(root, 404, transmission, 1); block.condition = 0; assert.equal(system.driveForce(2, 0, 0.315, 1), 0);
  world.dispose();
});

test('drivetrain keeps engine RPM independent of road speed, shifts and distributes front/rear torque', () => {
  const build = (drive: string, front = 0.5) => {
    const world = new EngineWorld(), make = (id: number, values: Record<string, number>, script = `${id}.java`) => world.create({
      key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, script,
      config: parsePartConfig('slot 0 0 0 0 0 0 1'), mechanics: { kind: 'engine', source: script, values, drive: id === 5 ? drive : undefined },
    });
    const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'root', cfgPath: 'root.cfg', config: parsePartConfig('slot 0 0 0 0 0 0 1') });
    for (let id = 2; id <= 8; id++) root.definition.config.slots.push({ id, position: [0, 0, 0], rotation: [0, 0, 0], attach: [], compatible: [] });
    const parts = [
      make(2, { cylinders: 6, bore: 80, rpm_idle: 900, RPM_limit: 6500 }), make(3, { stroke: 90 }),
      make(4, { intake_valve_diam: 32 }), make(5, { gears: 3, 'ratio[1]': 3.5, 'ratio[2]': 2.1, 'ratio[3]': 1.4, 'ratio[7]': -3, end_ratio: 3, drive_front: front }),
      make(6, {}, 'clutch.java'), make(7, {}, 'fuel_rail.java'), make(8, { rpm_turbo_opt: 3500, rpm_turbo_range: 3500, P_turbo_max: 1.2, P_turbo_waste: 0.8 }, 'turbocharger.java'),
    ];
    for (const part of parts) world.install(root, part.definition.key.id, part, 1);
    const system = new MechanicalSystem(root); system.reset(); return { world, system };
  };
  for (const [drive, front] of [['DT_FWD', 1], ['DT_RWD', 0], ['DT_FWD | DT_RWD', 0.7]] as const) {
    const { world, system } = build(drive, front);
    assert.equal(system.gear, 0);
    system.advance(1 / 240, { throttle: 0, gearUp: true }, [0, 0, 0, 0]);
    for (let i = 0; i < 60; i++) system.advance(1 / 240, { throttle: 0 }, [0, 0, 0, 0]);
    const result = system.advance(1 / 240, { throttle: 1 }, [0, 0, 0, 0]);
    assert.ok(Math.abs(result.torque[0]) > 0 || front === 0);
    assert.ok(Math.abs(result.torque[2]) > 0 || front === 1);
    if (front === 0) assert.equal(result.torque[0], 0);
    if (front === 1) assert.equal(result.torque[2], 0);
    if (front === 0.7) assert.ok(Math.abs(result.torque[0] / result.torque[2] - 0.7 / 0.3) < 1e-10);
    world.dispose();
  }
  const { world, system } = build('DT_RWD');
  for (let i = 0; i < 240; i++) system.advance(1 / 240, { throttle: 1 }, [0, 0, 0, 0]);
  assert.equal(system.gear, 0, 'throttle cannot engage neutral automatically');
  assert.ok(system.rpm > 2000, `neutral revs: ${system.rpm}`);
  system.advance(1 / 240, { throttle: 0, gearUp: true }, [0, 0, 0, 0]);
  assert.equal(system.gear, 1); assert.equal(system.manual, false, 'selecting drive keeps an automatic transmission automatic');
  for (let i = 0; i < 60; i++) system.advance(1 / 240, { throttle: 0 }, [0, 0, 0, 0]);
  for (let i = 0; i < 240; i++) system.advance(1 / 240, { throttle: 1, clutch: true }, [0, 0, 0, 0]);
  assert.ok(system.rpm > 2000, `free revs: ${system.rpm}`);
  assert.ok(system.boost > 0, `installed turbo produces boost: ${system.boost}`);
  system.advance(1 / 240, { throttle: 0, gearUp: true }, [0, 0, 0, 0]);
  assert.equal(system.gear, 2); assert.equal(system.manual, true);
  for (let i = 0; i < 60; i++) system.advance(1 / 240, { throttle: 0 }, [0, 0, 0, 0]);
  system.advance(1 / 240, { throttle: 0, gearDown: true }, [0, 0, 0, 0]); assert.equal(system.gear, 1);
  system.advance(1 / 240, { throttle: 1, neutral: true }, [0, 0, 0, 0]);
  assert.equal(system.gear, 0);
  assert.ok(system.advance(1 / 240, { throttle: 1 }, [0, 0, 0, 0]).torque.every(t => t === 0));
  system.reset(); assert.equal(system.gear, 0); assert.equal(system.boost, 0); assert.equal(system.manual, false);
  world.dispose();
});

test('automatic upshift follows road speed and cannot skip gears while the clutch reconnects', () => {
  const world = new EngineWorld(), cfg = parsePartConfig('slot 0 0 0 0 0 0 1');
  const make = (id: number, values: Record<string, number>, script = `${id}.java`) => world.create({
    key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, script, config: cfg,
    mechanics: { kind: 'engine', source: script, values, drive: id === 5 ? 'DT_RWD' : undefined },
  });
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'car', cfgPath: 'car.cfg', config: parsePartConfig('slot 0 0 0 0 0 0 1') });
  for (let id = 2; id <= 7; id++) root.definition.config.slots.push({ id, position: [0, 0, 0], rotation: [0, 0, 0], attach: [], compatible: [] });
  for (const part of [
    make(2, { cylinders: 6, bore: 80, rpm_idle: 1000, RPM_limit: 7000 }), make(3, { stroke: 90 }),
    make(4, { intake_valve_diam: 30 }), make(5, { gears: 5, 'ratio[1]': 3.58, 'ratio[2]': 2.49, 'ratio[3]': 1.66, end_ratio: 3.03 }),
    make(6, {}, 'clutch.java'), make(7, {}, 'fuel_rail.java'),
  ]) world.install(root, part.definition.key.id, part, 1);
  const system = new MechanicalSystem(root); system.reset(); system.gear = 1; system.rpm = 6300;
  const wheel = [0, 0, 50, 50], road = [0, 0, 50, 50];
  system.advance(1 / 240, { throttle: 1 }, wheel, road, 17);
  assert.equal(system.gear, 2);
  for (let i = 0; i < 120; i++) system.advance(1 / 240, { throttle: 1 }, wheel, road, 17);
  assert.equal(system.gear, 2, 'second gear stays engaged after the shift timer expires');
  assert.ok(system.rpm < 6000, `engine revs match second gear: ${system.rpm}`);
  world.dispose();
});

test('charger parser derives original boost band, wastegate and combined drive type', async () => {
  const path = 'parts/engines/mod/scripts/src/sample.java';
  const source = 'class sample extends TurboCharger { sample(int id) { calculateOptandRange(5000.0, 9000.0); P_turbo_max = 2.0; default_P_turbo_waste = 1.0; P_turbo_waste = default_P_turbo_waste; drive_type = DT_FWD | DT_RWD; type = TT_AUTO; } }';
  const assets = new Assets([{ path, size: source.length }], async () => new TextEncoder().encode(source));
  const definition: PartDefinition = { key: { pack: 'parts.rpk', id: 1 }, alias: 'sample', cfgPath: 'parts/engines/mod/sample.cfg', script: 'parts/engines/mod/scripts/sample.class', config: parsePartConfig('slot 0 0 0 0 0 0 1') };
  const profile = (await new OriginalStock(assets).profile(definition))!;
  assert.equal(profile.values.rpm_turbo_opt, 7000); assert.equal(profile.values.rpm_turbo_range, 2000);
  assert.equal(profile.values.P_turbo_waste, 1); assert.equal(profile.drive, 'DT_FWD | DT_RWD'); assert.equal(profile.transmissionType, 'TT_AUTO');
});

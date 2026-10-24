import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { MechanicalSystem } from '../src/engine/mechanical-system';
import { originalNumber, selectStockBranches, type MechanicalProfile } from '../src/engine/original-stock';
import { parsePartConfig } from '../src/formats/cfg';

test('original numeric units and conditional stock selection stay bounded and literal', () => {
  assert.equal(originalNumber('kgfPmm2NPm(7.3)'), 71613);
  assert.equal(originalNumber('Inch2Meter(8.5)'), 0.21589999999999998);
  assert.equal(originalNumber('240.0-58.0'), 182);
  assert.equal(originalNumber('process.exit(1)'), undefined);
  assert.equal(selectStockBranches('if(desc.power < 1.3) { addPart(low); } else { addPart(high); }', { 'desc.power': 1 }), ' addPart(low); ');
  assert.deepEqual(parsePartConfig('render 0x70 0 -0.245662 0').renderPose?.rotation, [0, 0, 0]);
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

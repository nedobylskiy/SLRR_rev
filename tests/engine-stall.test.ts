import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { MechanicalSystem } from '../src/engine/mechanical-system';

function engine(transmissionType: string) {
  const world = new EngineWorld();
  const slots = Array.from({ length: 6 }, (_, i) => `slot 0 0 0 0 0 0 ${i + 1}`).join('\n');
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'car', cfgPath: 'car.cfg', config: parsePartConfig(slots) });
  const parts: { script: string; values: Record<string, number>; transmissionType?: string }[] = [
    { script: 'block.java', values: { cylinders: 6, bore: 80, rpm_idle: 1000, RPM_limit: 7000 } },
    { script: 'crank.java', values: { stroke: 90 } },
    { script: 'head.java', values: { intake_valve_diam: 32 } },
    { script: 'transmission.java', values: { gears: 5, 'ratio[1]': 3.58, end_ratio: 3.03 }, transmissionType },
    { script: 'clutch.java', values: {} },
    { script: 'fuel_rail.java', values: {} },
  ];
  parts.forEach((definition, i) => {
    const part = world.create({ key: { pack: 'test.rpk', id: i + 2 }, alias: definition.script, cfgPath: `${i}.cfg`, script: definition.script,
      config: parsePartConfig('slot 0 0 0 0 0 0 1'), mechanics: { kind: 'engine', source: definition.script, values: definition.values, transmissionType: definition.transmissionType } });
    world.install(root, i + 1, part, 1);
  });
  const system = new MechanicalSystem(root); system.reset();
  const wheels = [0, 0, 0, 0];
  const step = (input: { throttle?: number; clutch?: boolean; gearUp?: boolean; start?: boolean } = {}) => system.advance(1 / 240, { throttle: input.throttle ?? 0, ...input }, wheels);
  return { world, system, step };
}

test('dropping an explicit manual clutch stalls against a stopped driveline and restarting with it open works', () => {
  const { world, system, step } = engine('TT_MANUAL');
  step({ gearUp: true,clutch:true });
  for(let i=0;i<60;i++)step({clutch:true}); // User-operated clutch overrides the lever's assisted reconnection.
  for (let i = 0; i < 360; i++) step();
  assert.equal(system.running, false);
  assert.equal(system.gear, 1);
  step({ clutch: true, start: true });
  for (let i = 0; i < 240; i++) step({ clutch: true });
  assert.equal(system.running, true);
  assert.ok(system.rpm > 600);
  world.dispose();
});

test('an automatic can idle in first, while a very low neutral idle can stall', () => {
  const { world, system, step } = engine('TT_AUTO');
  step({ gearUp: true });
  for (let i = 0; i < 360; i++) step();
  assert.equal(system.running, true);
  system.setTuning(350, 7000);
  system.reset();
  for (let i = 0; i < 480; i++) step();
  assert.equal(system.running, false);
  assert.throws(() => system.setTuning(100, 7000), /range/);
  world.dispose();
});


test('a freshly created manual drivetrain starts at idle and selects first without a compulsory stall',()=>{
  const {world,system:fixture}=engine('TT_MANUAL'),system=new MechanicalSystem(fixture.root);
  assert.equal(system.rpm,system.idleRpm);assert.equal(system.running,true);assert.equal(system.manual,true);assert.equal(system.gear,0);
  for(let tick=0;tick<360;tick++)system.advance(1/240,{throttle:0,gearUp:tick===0},[0,0,0,0]);
  assert.equal(system.running,true);assert.equal(system.gear,1);world.dispose();
});

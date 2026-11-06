import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { MechanicalSystem } from '../src/engine/mechanical-system';
import { createWheelRefState } from '../src/runtime/wheel-ref-native';

const corpus = new URL('../data/telemetry/original-game/2026-11-05/', import.meta.url);
interface CaptureSession {
  id: number; model: string; metadata: Record<string, string>;
  curves: { rpm: string; torque_nm: string; power_native_raw: string }[];
}
const captures = JSON.parse(readFileSync(new URL('manifest.json', corpus), 'utf8')).captures as { id: string }[];
const sessions = captures.flatMap(capture => {
  const report = JSON.parse(readFileSync(new URL(`${capture.id}/summary.json`, corpus), 'utf8'));
  return (report.sessions as CaptureSession[]).map(session => ({ ...session, capture: capture.id }));
});

// A brake dynamometer with prescribed wheel speed: this tests engine/clutch
// coupling independently of unrecorded tyre slip, road grade and chassis mass.
function dynamometer(session: CaptureSession, automatic = false, torqueScale = 1) {
  const m = session.metadata, number = (key: string) => Number(m[key]);
  const world = new EngineWorld();
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: session.model,
    cfgPath: 'root.cfg', config: parsePartConfig(Array.from({ length: 6 }, (_, i) => `slot 0 0 0 0 0 0 ${i+1}`).join('\n')) });
  const definitions: [string, Record<string, number>][] = [
    ['block.java', { cylinders: 4, bore: 80 }], ['crank.java', { stroke: 90 }],
    ['head.java', { intake_valve_diam: 32 }], ['transmission.java', { gears: number('gears') }],
    ['clutch.java', {}], ['fuel_rail.java', {}],
  ];
  definitions.forEach(([script, values], i) => {
    const part = world.create({ key: { pack: 'test.rpk', id: i+2 }, alias: script, cfgPath: script,
      script, config: parsePartConfig('slot 0 0 0 0 0 0 1'),
      mechanics: { kind: 'engine', source: script, values, transmissionType: automatic ? 'TT_AUTO' : 'TT_MANUAL' } });
    world.install(root, i+1, part, 1);
  });
  const torque = session.curves.map(row => Number(row.torque_nm)*torqueScale);
  const watts = session.curves.map(row => Number(row.power_native_raw));
  const parameters = { engine_rpm_idle: number('idle_rpm'), RPM_limit: number('redline_rpm'),
    engine_inertia: number('engine_inertia'), engine_mass: number('engine_mass'),
    rearend_ratio: number('final_drive'), ClutchF: number('clutch_force'), starter_torque: 40 };
  world.javaPowertrain = { curve: { rpmStep: 500, torque, watts, nitroTorque: torque, nitroWatts: watts },
    state: { revision: 1, parameters, ratios: Array.from({ length: 8 }, (_, i) => number(`ratio_${i}`)), descendantPartIds: [] } };
  const system = new MechanicalSystem(root); system.reset(); system.gear = 2;
  const ratio = number('ratio_2') * number('final_drive');
  const tick = (shaftRpm: number, throttle: number, clutch = false) => {
    const wheel = shaftRpm * Math.PI / 30 / ratio;
    return system.advance(1/240, { throttle, throttleMode: 'pedal', clutch }, [wheel,wheel,wheel,wheel]);
  };
  return { world, system, tick, parameters };
}

// One configuration from every model, plus the explicit turbo/NA pair.
const references = sessions.filter(s => s.id === 1 && !s.capture.startsWith('06-'));
references.push(sessions.find(s => s.capture.startsWith('04-') && s.id === 2)!);
for (const session of references) {
  test(`${session.model} capture ${session.capture}/${session.id}: loaded engine settles below limiter`, () => {
    const { world, system, tick } = dynamometer(session);
    try {
      const shaftRpm = 2000;
      system.rpm = shaftRpm;
      for (let i=0; i<240; i++) tick(shaftRpm, 1);
      assert.ok(system.running);
      // The host's finite-inertia exchange retains a timestep-dependent speed
      // difference under load. Require a settled loaded engine, not exact lock.
      const loadedRpm = system.rpm;
      for (let i=0; i<240; i++) tick(shaftRpm, 1);
      if (process.env.SLRR_ENGINE_REPORT) console.log(JSON.stringify({ model: session.model, capture: session.capture,
        session: session.id, shaftRpm, rpmAfter1s: loadedRpm, rpmAfter2s: system.rpm }));
      assert.ok(system.rpm < system.redlineRpm*0.8, `${session.model}: loaded RPM ${system.rpm} must remain below limiter`);
      assert.ok(Math.abs(system.rpm-loadedRpm)<10, `${session.model}: loaded RPM must settle`);
    } finally { world.dispose(); }
  });
}

test('captured Einvagen can stall on a held shaft with manual clutch, while automatic clutch releases', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 2)!;
  for (const automatic of [false,true]) {
    const { world, system, tick } = dynamometer(session,automatic);
    try {
      system.rpm = 6500;
      for (let i=0; i<720; i++) tick(0, automatic ? 0 : 1);
      assert.equal(system.running, automatic);
      if (automatic) assert.ok(system.rpm >= system.idleRpm*0.8);
    } finally { world.dispose(); }
  }
});

test('native exchange does not interpret ClutchF as an SI torque cap, and an open clutch transmits no torque', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  let referenceRpm: number | undefined;
  for (const capacity of [0,50,500]) {
    const { world, system, tick, parameters } = dynamometer(session);
    try {
      parameters.ClutchF = capacity; system.rpm = 3000;
      for (let i=0; i<240; i++) tick(3000,1);
      if (referenceRpm === undefined) referenceRpm = system.rpm;
      assert.equal(system.rpm,referenceRpm, `ClutchF ${capacity} must not impose an invented torque cap`);
      assert.ok(tick(3000,1,true).torque.every(torque => torque===0));
    } finally { world.dispose(); }
  }
});

test('high-torque engines settle under load instead of slipping against the old 500-unit ceiling', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  for (const scale of [1,4,6]) {
    const { world, system, tick } = dynamometer(session,false,scale);
    try {
      system.rpm = 3000;
      for (let i=0;i<480;i++) tick(3000,1);
      assert.ok(system.rpm<system.redlineRpm*0.8, `torque scale ${scale}: RPM ${system.rpm}`);
      const rpm = system.rpm;
      for (let i=0;i<240;i++) tick(3000,1);
      assert.ok(Math.abs(system.rpm-rpm)<1, 'loaded engine settles instead of climbing to the limiter');
    } finally { world.dispose(); }
  }
});

test('closed clutch feedback cannot create energy when actual wheel speeds are integrated', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  for (const weights of [[0,0,0.5,0.5],[0.25,0.25,0.25,0.25],[0.05,0.05,0.45,0.45]]) {
    const { world, system, parameters } = dynamometer(session);
    try {
      // Large native CFG inertia used to over-apply wheel angular impulse in
      // the SI integrator. Prescribed-speed dynamometer tests cannot detect it.
      system.root.definition.config.enginePower = [100,4,0.00006,0.003,1000,50];
      world.wheelRefs = weights.map(drive=>({...createWheelRefState(),drive}));
      system.rpm=6000;system.running=false;system.gear=1;
      const omega=[0,0,0,0], dt=1/240, inertia=0.28+parameters.engine_inertia*0.01;
      const energy=()=>0.5*inertia*(system.rpm*Math.PI/30)**2+omega.reduce((sum,w)=>sum+0.5*1.6*w*w,0);
      let previous=energy();
      for(let i=0;i<480;i++) {
        const result=system.advance(dt,{throttle:0,throttleMode:'pedal'},omega);
        result.torque.forEach((torque,w)=>{omega[w]+=torque/1.6*dt;});
        const next=energy();
        assert.ok(Number.isFinite(next) && next<=previous+1e-6,`passive clutch creates energy: ${previous} -> ${next}`);
        previous=next;
      }
    } finally { world.dispose(); }
  }
});

test('powered engine-wheel feedback stays bounded across drive splits and gear ratios', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  for (const weights of [[0,0,0.5,0.5],[0.25,0.25,0.25,0.25],[0.05,0.05,0.45,0.45]]) {
    for (const gear of [1,2,5,-1]) {
      const { world, system, parameters } = dynamometer(session,false,6);
      try {
        world.wheelRefs=weights.map(drive=>({...createWheelRefState(),drive}));
        system.gear=gear;system.rpm=3000;
        const wheels=[0,0,0,0],dt=1/240;
        const ratio=(gear<0?-3.5:Number(session.metadata[`ratio_${gear}`]))*parameters.rearend_ratio;
        for(let i=0;i<1200;i++) {
          const result=system.advance(dt,{throttle:1,throttleMode:'pedal'},wheels);
          result.torque.forEach((torque,w)=>{wheels[w]+=torque/1.6*dt;});
          assert.ok(Number.isFinite(system.rpm) && system.rpm<system.redlineRpm*1.15);
          const shaft=wheels.reduce((sum,omega,w)=>sum+omega*weights[w],0)*ratio*30/Math.PI;
          assert.ok(Math.abs(system.rpm-shaft)<10,`closed loop mismatch ${system.rpm} vs ${shaft}`);
        }
      } finally {world.dispose();}
    }
  }
});

test('gas cranks a stalled native engine gradually before combustion catches', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  const { world, system, tick } = dynamometer(session);
  try {
    system.running = false; system.rpm = 0; system.gear = 0;
    tick(0,1);
    assert.ok(system.starting && !system.running);
    assert.ok(system.rpm>0 && system.rpm<100, 'no instantaneous jump to idle');
    for (let i=0;i<360;i++) tick(0,1);
    assert.ok(system.running && !system.starting);
  } finally { world.dispose(); }
});

test('starter torque reaches wheels in forward and reverse through a closed manual clutch', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  for (const gear of [1,-1]) {
    const { world, system, tick } = dynamometer(session);
    try {
      system.running = false; system.rpm = 0; system.gear = gear;
      let impulse = 0;
      for (let i=0;i<120;i++) impulse += tick(0,1).torque.reduce((a,b)=>a+b,0)/240;
      assert.ok(impulse*gear>0, `starter wheel impulse ${impulse} in gear ${gear}`);
      assert.ok(system.starting && !system.running, 'held driveline prevents combustion catching');
      assert.ok(tick(0,1,true).torque.every(t=>t===0), 'open clutch isolates starter from wheels');
      tick(0,0); assert.equal(system.starting,false,'releasing gas releases the starter');
    } finally { world.dispose(); }
  }
});

test('zero starter torque or a disconnected block cannot start the engine on gas', () => {
  const session = sessions.find(s => s.capture.startsWith('06-') && s.id === 4)!;
  for (const disconnected of [false,true]) {
    const { world, system, tick, parameters } = dynamometer(session);
    try {
      system.running = false; system.rpm = 0; system.gear = 0;
      if(disconnected) world.detach(system.block!); else parameters.starter_torque = 0;
      for(let i=0;i<480;i++) tick(0,1);
      assert.equal(system.running,false); assert.equal(system.rpm,0);
      if(disconnected) assert.equal(system.starting,false);
    } finally { world.dispose(); }
  }
});

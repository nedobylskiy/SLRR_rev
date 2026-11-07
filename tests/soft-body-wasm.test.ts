import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Matrix4 } from 'three';
import { DeformablePanel, type PanelOptions } from '../src/engine/deformable-panel';
import { SoftBodyRuntime, softBodyRuntime } from '../src/engine/soft-body-wasm';

const bytes = () => readFile(new URL('../src/engine/wasm/soft-body.wasm', import.meta.url));
const samples = [-0.7, 1.3, -0.7, 0.7, 1.3, -0.7, -0.7, 1.3, 0.7, 0.7, 1.3, 0.7, 0, 1.35, 0];
const close = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

test('failed/malformed/missing WASM loads leave a usable TS fallback', async () => {
  for (const read of [async () => { throw new Error('HTTP 404'); }, async () => new Uint8Array([1, 2, 3]), async () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])]) {
    const runtime = new SoftBodyRuntime();
    assert.equal(await runtime.load(read), false);
    assert.equal(runtime.available, false); assert.ok(runtime.error);
    assert.equal(runtime.create(18, 0, 0, 1, 'auto'), undefined);
  }
  const fallback = new DeformablePanel(samples, { mass: 38.5, mount: [0, 1.3, 0.7], backend: 'ts' });
  fallback.hit(45); fallback.advance(1 / 60);
  assert.equal(fallback.backend, 'ts'); assert.ok(fallback.positions.every(Number.isFinite));
});

test('unavailable WebAssembly does not prevent the TS solver from running', async () => {
  const original = globalThis.WebAssembly;
  try {
    Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, writable: true, value: undefined });
    const runtime = new SoftBodyRuntime();
    assert.equal(await runtime.load(bytes), false);
    assert.match(runtime.error!, /unavailable/);
    const panel = new DeformablePanel(samples, { mass: 38.5, mount: [0, 1.3, 0.7], backend: 'ts' });
    panel.advance(1 / 60); assert.ok(panel.positions.every(Number.isFinite));
  } finally { Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, writable: true, value: original }); }
});

test('C++/WASM matches TS deformation, contacts, collective release, reset and negative terrain', async () => {
  assert.equal(await softBodyRuntime.load(bytes), true, softBodyRuntime.error);
  for (const resolution of [[4, 5], [7, 9], [16, 16]] as const) {
    const options: PanelOptions = { mass: 38.5, mount: [0, 1.3, 0.7], resolution: [...resolution], mountStrength: 500 };
    const ts = new DeformablePanel(samples, { ...options, backend: 'ts' });
    const wasm = new DeformablePanel(samples, { ...options, backend: 'wasm' });
    assert.equal(wasm.backend, 'wasm');
    assert.equal(wasm.positions.buffer.byteLength, 640 * 1024);
    for (const p of [ts, wasm]) {
      p.setAnchorFrame(new Matrix4().makeTranslation(0, -4, 0).elements); p.reset();
      p.groundHeight = (x, z) => -4 + x * 0.02 + z * 0.03;
      p.colliders.push({ min: [-0.3, -2.9, -0.5], max: [0.3, -2.7, 0], restitution: 0.2, friction: 0.5 });
      p.hit(650);
    }
    const buffers = [wasm.positions, wasm.rest, wasm.velocities];
    let released = false, contacts = 0;
    for (let tick = 0; tick < 300; tick++) {
      ts.advance(1 / 240); wasm.advance(1 / 240);
      assert.equal(wasm.attached, ts.attached); assert.equal(wasm.contacts, ts.contacts);
      released ||= !wasm.attached; contacts += wasm.contacts;
      for (const key of ['positions', 'rest', 'velocities'] as const)
        for (let i = 0; i < ts[key].length; i++) close(wasm[key][i], ts[key][i], `${resolution} ${key}[${i}], tick ${tick}`);
      for (let i = 0; i < ts.beams.length; i++) close(wasm.beams[i].rest, ts.beams[i].rest, 'plastic rest length');
      for (let i = 0; i < ts.mounts.length; i++) {
        assert.equal(wasm.mounts[i].broken, ts.mounts[i].broken);
        close(wasm.mounts[i].force, ts.mounts[i].force, 'mount load');
      }
    }
    assert.ok(released); assert.ok(contacts > 0);
    assert.ok(wasm.positions.some((v, i) => i % 3 === 1 && v < 0));
    wasm.reset(); assert.deepEqual(wasm.positions, wasm.rest);
    assert.equal(wasm.plasticBeams, 0); assert.ok(wasm.mounts.every(m => !m.broken));
    assert.equal(wasm.positions, buffers[0]); assert.equal(wasm.rest, buffers[1]); assert.equal(wasm.velocities, buffers[2]);
  }
});

test('more than 64 AABBs uses TS contacts while retaining the WASM numerical kernel', async () => {
  assert.equal(await softBodyRuntime.load(bytes), true);
  const options: PanelOptions = { mass: 38.5, mount: [0, 1.3, 0.7], resolution: [4, 5] };
  const ts = new DeformablePanel(samples, { ...options, backend: 'ts' }), wasm = new DeformablePanel(samples, { ...options, backend: 'wasm' });
  for (const panel of [ts, wasm]) {
    for (let index = 0; index < 65; index++) panel.colliders.push({ min: [-2, 1.2, -2], max: [2, 1.3, 2] });
    panel.hit(45);
  }
  let contacts = 0;
  for (let tick = 0; tick < 80; tick++) {
    ts.advance(1 / 240); wasm.advance(1 / 240); contacts += wasm.contacts;
    assert.equal(ts.contacts, wasm.contacts);
    for (let i = 0; i < ts.positions.length; i++) close(wasm.positions[i], ts.positions[i], 'AABB capacity fallback');
  }
  assert.ok(contacts > 0); assert.equal(wasm.backend, 'wasm');
});

test('switching TS/WASM preserves state and panel instances own independent memory', async () => {
  assert.equal(await softBodyRuntime.load(bytes), true);
  const options: PanelOptions = { mass: 38.5, mount: [0, 1.3, 0.7] };
  const reference = new DeformablePanel(samples, { ...options, backend: 'ts' }), switched = new DeformablePanel(samples, options);
  assert.notEqual(reference.positions.buffer, switched.positions.buffer);
  const other = new DeformablePanel(samples, options);
  assert.notEqual(switched.positions.buffer, other.positions.buffer);
  for (const p of [reference, switched]) p.hit(45);
  try {
    for (let tick = 0; tick < 240; tick++) {
      softBodyRuntime.preference = tick % 40 < 20 ? 'ts' : 'wasm';
      assert.equal(switched.backend, softBodyRuntime.preference);
      reference.advance(1 / 240); switched.advance(1 / 240);
      for (let i = 0; i < reference.positions.length; i++) close(switched.positions[i], reference.positions[i], `switched node ${i}`);
    }
  } finally { softBodyRuntime.preference = 'auto'; }
});


test('profiled split constraints/contacts preserve TS and WASM trajectories and expose separate counters',async()=>{
  assert.equal(await softBodyRuntime.load(bytes),true);
  for(const backend of ['ts','wasm'] as const){
    const options:PanelOptions={mass:38.5,mount:[0,1.3,.7],backend};
    const baseline=new DeformablePanel(samples,options),profiled=new DeformablePanel(samples,options);profiled.profiling=true;
    for(const panel of [baseline,profiled]){panel.hit(650);panel.colliders.push({min:[-.3,.7,-.5],max:[.3,.9,0]});}
    for(let i=0;i<100;i++){baseline.advance(2/240);profiled.advance(2/240);assert.deepEqual(profiled.positions,baseline.positions);assert.deepEqual(profiled.velocities,baseline.velocities);assert.equal(profiled.attached,baseline.attached);}
    assert.equal(profiled.profile.steps,2);assert.ok(profiled.profile.constraints>0);assert.ok(profiled.profile.contacts>0);assert.ok(profiled.profile.integration>0);
    if(backend==='wasm')assert.ok(profiled.profile.upload>0);else assert.equal(profiled.profile.upload,0);
    assert.equal(baseline.profile.steps,0,'profiling is opt-in');
  }
});

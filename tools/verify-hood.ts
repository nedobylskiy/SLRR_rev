import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseScx } from '../src/formats/scx';
import { parsePartConfig } from '../src/formats/cfg';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { gameRoot } from './game-files';

const cfg = parsePartConfig((await readFile(`${gameRoot}/cars/racers/Baiern_data/scripts/hood.cfg`)).toString('latin1'));
const model = parseScx(await readFile(`${gameRoot}/cars/racers/Baiern_data/meshes/hood.scx`));
const samples = model.meshes.flatMap(m => Array.from(m.positions, (v, i) => v * 0.01 + (i % 3 === 1 ? 1.25 : 0)));
const mass = cfg.bodies.reduce((s, b) => s + b.mass, 0), slot = cfg.slots.find(s => s.attach.length)!;
const results = [];
for (const impulse of [0, 5, 65, 650]) {
  const panel = new DeformablePanel(samples, { mass, mount: [slot.position[0], slot.position[1] + 1.25, slot.position[2]] });
  for (let i = 0; i < samples.length; i += 3) { const out = [0, 0, 0]; panel.skin(panel.bind(samples.slice(i, i + 3)), out); out.forEach((v, axis) => assert.ok(Math.abs(v - samples[i + axis]) < 1e-9)); }
  for (let i = 0; i < 240; i++) panel.advance(1 / 240);
  const baseline = panel.positions.slice(); panel.hit(impulse); let peak = 0;
  for (let i = 0; i < 1440; i++) { panel.advance(1 / 240); panel.positions.forEach((v, j) => { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v - baseline[j])); if (j % 3 === 1) assert.ok(v >= 0.015); }); }
  const residue = Math.max(...panel.positions.map((v, i) => Math.abs(v - baseline[i])));
  const broken = panel.mounts.filter(m => m.broken).length;
  if (impulse <= 5) { assert.equal(broken, 0); assert.equal(panel.plasticBeams, 0); assert.ok(residue < 0.0005); }
  if (impulse === 5) assert.ok(peak > 0.001);
  if (impulse === 65) { assert.equal(broken, 0); assert.ok(panel.plasticBeams > 0); assert.ok(residue > 0.005); }
  if (impulse === 650) { assert.equal(broken, 3); assert.equal(panel.attached, false); }
  results.push({ impulse, mass, broken, plasticBeams: panel.plasticBeams, peakMetres: peak, residueMetres: residue });
}
await mkdir('local', { recursive: true }); await writeFile('local/hood-verification.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

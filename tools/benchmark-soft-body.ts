import { readFile } from 'node:fs/promises';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { softBodyRuntime } from '../src/engine/soft-body-wasm';

if (!await softBodyRuntime.load(() => readFile(new URL('../src/engine/wasm/soft-body.wasm', import.meta.url))))
  throw new Error(softBodyRuntime.error);
const samples = [-0.7, 1.3, -0.7, 0.7, 1.3, -0.7, -0.7, 1.3, 0.7, 0.7, 1.3, 0.7, 0, 1.35, 0];
const steps = 1000, repeats = 5;
for (const backend of ['ts', 'wasm'] as const) {
  const panel = new DeformablePanel(samples, { mass: 38.5, mount: [0, 1.3, 0.7], backend });
  if (panel.backend !== backend) throw new Error(`Benchmark requested ${backend}, received ${panel.backend}`);
  panel.colliders.push({ min: [-0.3, 0.7, -0.5], max: [0.3, 0.9, 0], friction: 0.5 });
  const run = () => { panel.reset(); panel.hit(650); for (let i = 0; i < steps; i++) panel.advance(1 / 240); };
  run(); // Include packing and JS collision handling, after V8 warmup.
  const times: number[] = [];
  for (let i = 0; i < repeats; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  console.log(`${backend}: ${steps} active ticks, ${panel.positions.length / 3} nodes, ${panel.beams.length} beams; median ${times[2].toFixed(2)} ms (${(times[2] / steps).toFixed(4)} ms/tick)`);
}

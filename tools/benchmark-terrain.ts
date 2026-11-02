import { MapTerrain } from '../src/engine/map-terrain';
import type { ScxModel } from '../src/formats/scx';
const positions: number[] = [], indices: number[] = [];
const cells = 40, size = 16 / cells;
for (let x = 0; x < cells; x++) for (let z = 0; z < cells; z++) {
  const start = positions.length / 3;
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) positions.push((x + dx) * size * 100, (x + dx + z + dz) * size, (z + dz) * size * 100);
  indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
}
const terrain = new MapTerrain();
terrain.add({ version: 3, warnings: [], meshes: [{ name: 'dense support', positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: new Float32Array(positions.length), uv: new Float32Array(positions.length / 3 * 2), diffuse: [1, 1, 1, 1], textureIndex: 0 }] } satisfies ScxModel);
const queries = 20000, times: number[] = [];
let sum = 0;
for (let repeat = 0; repeat < 6; repeat++) {
  const start = performance.now();
  for (let i = 0; i < queries; i++) sum += terrain.height((i * 0.137) % 15.9, (i * 0.291) % 15.9, 2);
  if (repeat) times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ faces: terrain.faces, queries, medianMs: times[2], checksum: sum }));

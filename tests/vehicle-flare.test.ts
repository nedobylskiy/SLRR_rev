import test from 'node:test';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { createVehicleFlare } from '../src/render/vehicle-flare';

test('PNG lamp flare preserves image dimensions and alpha without PTX atlas cropping', async () => {
  const savedBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let reads = 0, closes = 0;
  const draws: unknown[][] = [];
  const bitmap = { width: 96, height: 48, close: () => { closes++; } };
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => bitmap });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 0, height: 0, getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }),
  }) } });
  try {
    const assets = new Assets([{ path: 'cars/racers/textures/light_beams/flares.png', size: 4 }],
      async () => { reads++; return new Uint8Array([137, 80, 78, 71]); });
    const source = { texture: 'cars\\racers\\textures\\light_beams\\flares.png', color: [1, 0, 0] as [number, number, number],
      alpha: 1, position: [0, 0, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number], cone: 2.65, size: 10, offset: 4 };
    const a = await createVehicleFlare(source, assets), b = await createVehicleFlare(source, assets);
    assert.equal(reads, 1, 'reuse decoded image across the two lamps');
    assert.equal(closes, 1);
    assert.equal(a.material.map!.image.width, 96);
    assert.equal(a.material.map!.image.height, 48);
    assert.deepEqual(draws, [[bitmap, 0, 0]], 'draw RGBA image directly without replacing alpha or selecting a PTX tile');
    assert.equal(a.material.transparent, true);
    const atlas = await createVehicleFlare({ ...source, textureMode: 2 }, assets);
    assert.deepEqual(atlas.material.map!.repeat.toArray(), [0.5, 0.5]);
    assert.deepEqual(atlas.material.map!.offset.toArray(), [0, 0.5]);
    assert.notEqual(a.material.map, b.material.map, 'GPU texture lifetimes remain independent');
    for (const sprite of [a, b, atlas]) { sprite.material.map!.dispose(); sprite.material.dispose(); }
  } finally {
    for (const [key, descriptor] of [['createImageBitmap', savedBitmap], ['document', savedDocument]] as const)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

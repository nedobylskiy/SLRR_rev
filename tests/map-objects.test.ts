import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mapObjectPlacements, mapObjectSeed, mapRenderResource, isNightMapRenderResource, parseIcfg } from '../src/engine/map-objects';
import { parsePartConfig } from '../src/formats/cfg';
import type { RpkPack } from '../src/formats/rpk';

test('CFG render variants replace the placeholder component and preserve empty variants', () => {
  const config = parsePartConfig('render 0x1de 6 6.5 1.5 0 0 0\nrendertypes 3 0x21 0x36 0\nrender 0x646 9 2.5 0 0 0 0\nlod 2 2\nrendertypes 2 0x646 0x647');
  assert.equal(config.renders[0].resource, 0x1de);
  assert.deepEqual(config.renders[0].pose?.position, [6, 6.5, 1.5]);
  assert.equal(mapRenderResource(config.renders[0]), 0x21);
  assert.equal(mapRenderResource(config.renders[0], 1), 0x36);
  assert.equal(mapRenderResource(config.renders[0], 2), 0);
  assert.equal(mapRenderResource(config.renders[1]), 0x646);
  assert.deepEqual(config.renders[1].lod, [2, 2]);
  assert.equal(mapRenderResource({ resource: 0x123 }), 0x123);
  const orphan = parsePartConfig('rendertypes 2 0x340 0x342\nrender 0x35f');
  assert.equal(mapRenderResource(orphan.renders[0]), 0x35f);
  assert.equal(orphan.unknown[0].command, 'rendertypes');
});

test('original object seed uses float32 position sum or explicit seventh parameter and synchronizes variants', () => {
  const pack: RpkPack = { version: 0x200, dependencies: [{ id: 0x00020000, path: 'objects.rpk', trailer: 0 }], entries: [], warnings: [] };
  const rdb = (params: string) => `<FILE 00000002.res >\ntypeof 1\n</FILE>\n<FILE 00000002.rsd >\ngametype 0x0002004e\nparams ${params}\n</FILE>`;
  const placement = mapObjectPlacements(rdb('586.900,1.000,290.705,2.903,0,0'), pack)[0];
  assert.equal(mapObjectSeed(placement), 878);
  const explicit = mapObjectPlacements(rdb('586.900,1.000,290.705,2.903,0,0,7'), pack)[0];
  assert.equal(mapObjectSeed(explicit), 7);
  assert.equal(mapObjectSeed({ ...placement, seed: -1 }), 878);
  assert.equal(mapObjectSeed({ pose: { position: [-120.9, 1, 0], rotation: [0, 0, 0] } }), 2147483529);
  // Preserve SSE float32 rounding before integer truncation.
  assert.equal(mapObjectSeed({ pose: { position: [16777216, 1, -16777216], rotation: [0, 0, 0] } }), 0);
  const config = parsePartConfig('render 0x1de\nrendertypes 3 0x21 0x36 0\ncolors 2 0xAF9B88 DEDEDE\nrender 0x646\nrendertypes 3 0x646 0x647 0x648');
  assert.equal(mapRenderResource(config.renders[0], 7), 0x36);
  assert.equal(mapRenderResource(config.renders[1], 7), 0x647);
  assert.equal(config.renders[0].colors![7 % 2], 0xdedede);
});

test('RDB instances retain original world pose and resolve dependency namespace', () => {
  const pack: RpkPack = { version: 0x200, dependencies: [{ id: 0x00060000, path: 'objects.rpk', trailer: 0 }], entries: [], warnings: [] };
  const rdb = `<FILE 0000074e.res >\ntypeof 1\nalias kont\n</FILE>\n<FILE 0000074e.rsd >\ngametype 0x00060527\nparams -241.218,1.431,-998.091,3.142,0.000,0.000\n</FILE>`;
  assert.deepEqual(mapObjectPlacements(rdb, pack), [{ id: 0x74e, alias: 'kont', typeId: 0x00060527,
    pose: { position: [-241.218, 1.431, -998.091], rotation: [3.142, 0, 0] } }]);
});

test('compiled ICFG exposes the original box body and render reference', () => {
  const config = 'bounds -2 -1 -1 2 1 1\nbody 0 0 0 0 0 0 0 box 2 1 1\nrender 0x522 0 0 0 0 0 0\neof\n';
  const bytes = new Uint8Array([...new TextEncoder().encode('ICFG'), 0, 0, 0, 0, ...new TextEncoder().encode('object\0'), ...new TextEncoder().encode(config)]);
  const parsed = parseIcfg(bytes);
  assert.deepEqual(parsed.bodies[0].shape, ['box', '2', '1', '1']);
  assert.equal(parsed.renders[0].resource, 0x522);
});

test('daytime map filtering removes explicit night variants while retaining daytime buildings and ordinary components',()=>{
  for(const alias of ['krthaz02_night','night_vreklam3aa','night_reklam1nad','NIGHT_reklam1faa'])assert.equal(isNightMapRenderResource(alias),true,alias);
  for(const alias of ['krthaz02','vreklam3aa','reklam1nad','lamp_base','trafficlamp','06x5_shop_uveg','nightclub'])assert.equal(isNightMapRenderResource(alias),false,alias);
  const cfg=parsePartConfig('render 0x1ad 1 2 3 0 0 0\nflags 68\nrender 0x4ba 1 2 3 0 0 0\nflags 4\nrender 0x118\nflags 4');
  const aliases=new Map([[0x1ad,'krthaz02'],[0x4ba,'krthaz02_night'],[0x118,'lamp_base']]);
  assert.deepEqual(cfg.renders.filter(r=>!isNightMapRenderResource(aliases.get(r.resource)!)).map(r=>r.resource),[0x1ad,0x118]);
});

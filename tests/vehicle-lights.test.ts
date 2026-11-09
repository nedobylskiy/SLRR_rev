import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePartConfig, secondaryRenders } from '../src/formats/cfg';
import { cfgRenderVisible, applyCfgRenderChannels, drivingLightMask, configureCfgLampEmission, cfgLampRenderFlags } from '../src/render/vehicle-lights';
import { vehicleLight } from '../src/engine/vehicle-light';
import { Assets } from '../src/assets';
import type { RpkPack } from '../src/formats/rpk';

test('Baiern rear overlays assign red geometry to running lamps and amber geometry to indicators',()=>{
  for(const [side,indicator] of [['L',16],['R',32]] as const){
    const path=`cars\\racers\\Baiern_data\\meshes\\${side}_taillights_`;
    const amber=cfgLampRenderFlags(path+'CITY.scx',4),red=cfgLampRenderFlags(path+'INDICATOR.scx',indicator);
    assert.equal(amber,indicator);assert.equal(red,4);
    assert.equal(cfgRenderVisible(amber,4),false);assert.equal(cfgRenderVisible(red,4),true);
    assert.equal(cfgRenderVisible(amber,indicator),true);assert.equal(cfgRenderVisible(red,indicator),false);
    assert.equal(cfgLampRenderFlags(path+'BRAKE.scx',1),1);assert.equal(cfgLampRenderFlags(path+'REVERSING.scx',2),2);
  }
  assert.equal(cfgLampRenderFlags('cars/racers/Einvagen_data/meshes/L_taillights_CITY.scx',4),4);
});

test('RPK lamp render resolves its own flare texture and ARGB settings instead of requiring SCX', async () => {
  const encoder = new TextEncoder();
  const assets = new Assets([], async () => new Uint8Array());
  const pack: RpkPack = { version: 512, dependencies: [], warnings: [], entries: [
    { typeId: 15, superId: 0, type: 13, flags: 0, compatibility: 0, offset: 0, size: 0, alias: 'taillights',
      data: encoder.encode('type spot\nlf_texture 0x100\nlf_glow_color 1 1 0 0\ndirection 0 -0.85 -1\nphi 2.65\nlf_glow_maxsize 10\nlf_glow_offset 4') },
    { typeId: 256, superId: 0, type: 7, flags: 0, compatibility: 0, offset: 0, size: 0, alias: 'flare',
      data: encoder.encode('sourcefile maps/skydome/lensflare/Flares.ptx') },
  ] };
  assets.pack = async () => pack;
  const source = await vehicleLight(assets, 'cars/racers.rpk', 15);
  assert.deepEqual(source, { texture: 'maps/skydome/lensflare/Flares.ptx', alpha: 1, color: [1, 0, 0],
    position: [0, 0, 0], direction: [0, -0.85, -1], cone: 2.65, size: 10, offset: 4 });
  assert.equal(await vehicleLight(assets, 'cars/racers.rpk', 256), undefined);
  pack.entries[0].data = encoder.encode('type fakespot\nlf_texture 0x100\nlf_glow_color 1 1 0 0\nlf_glow_colortype 2\ndiffuse 1 0.699 0.699 0.699');
  const reversing = await vehicleLight(assets, 'cars/racers.rpk', 15);
  assert.deepEqual(reversing!.color, [0.699, 0.699, 0.699], 'type 2 reverse light uses diffuse white despite the unused red glow color');
  pack.entries[0].data = encoder.encode('type spot\nlf_texture 0x100\nlf_glow_color 1 1 0 0\nlf_glow_colortype 2\ndiffuse 1 0.95 0 0');
  assert.deepEqual((await vehicleLight(assets, 'cars/racers.rpk', 15))!.color, [0.95, 0, 0], 'brake light remains red in the same mode');
});

test('CFG associates repeated activation flags with their own lamp render, without flagging the base lens', () => {
  const cfg = parsePartConfig('render 0x75\nrender 0xea 0 0 0 0 0 0\nflags 4\nrender 0xe8 0 0 0 0 0 0\nflags 1\nrender 0xee 0 0 0 0 0 0\nflags 2\nrender 0xec\nflags 16\nflags 32');
  assert.equal(cfg.renders[0].flags, undefined);
  assert.deepEqual(secondaryRenders(cfg).map(render => render.flags), [4, 1, 2, 48]);
  assert.equal(cfgRenderVisible(cfg.renders[0].flags), true);
  for (const render of secondaryRenders(cfg)) assert.equal(cfgRenderVisible(render.flags), false);
  assert.equal(cfgRenderVisible(1, 1), true);
  assert.equal(cfgRenderVisible(2, 1), false);
  assert.equal(cfgRenderVisible(2, 3), true);
  assert.equal(cfgRenderVisible(4, 3), false);
  assert.equal(cfgRenderVisible(48, 32), true);
});


test('lamp channels switch without recreating a part or hiding its base mesh', () => {
  const lens = { userData: {}, visible: true };
  const brake = { userData: { lightFlags: 1 }, visible: true };
  const reverse = { userData: { lightFlags: 2 }, visible: true };
  const group = { children: [lens, brake, reverse] };
  applyCfgRenderChannels(group, 0); assert.deepEqual(group.children.map(c => c.visible), [true, false, false]);
  applyCfgRenderChannels(group, 1); assert.deepEqual(group.children.map(c => c.visible), [true, true, false]);
  applyCfgRenderChannels(group, 2); assert.deepEqual(group.children.map(c => c.visible), [true, false, true]);
});


test('night lights persist with the engine running, preserve other channels and stop in daylight', () => {
  assert.equal(drivingLightMask(16, false, false, true, 23 * 3600), 20);
  assert.equal(drivingLightMask(20, true, true, true, 2 * 3600), 23);
  assert.equal(drivingLightMask(23, false, false, false, 2 * 3600), 16);
  assert.equal(drivingLightMask(20, false, false, true, 12 * 3600), 16);
  assert.equal(drivingLightMask(0, false, false, true, 18 * 3600), 4);
  assert.equal(drivingLightMask(4, false, false, true, 6 * 3600), 0);
  assert.equal(drivingLightMask(0, false, false, true, -3600), 4);
});

test('headlight resolves both attenuation textures relative to the owning resource pack', async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const entries = [
    { typeId: 8, type: 13, data: encode('type spot\nlf_texture 0x100\nattH_texture 11\nattV_texture 12\ndiffuse 1 0.7 0.8 0.9\nrange 800\ntheta 0.896\nphi 2.5') },
    { typeId: 256, type: 7, data: encode('sourcefile glow.ptx') },
    { typeId: 11, type: 7, data: encode('sourcefile horizontal.dds') },
    { typeId: 12, type: 7, data: encode('sourcefile vertical.png') },
  ];
  const assets = new Assets([], async () => new Uint8Array());
  const packs: string[] = [];
  assets.resource = async (pack, id) => {
    packs.push(pack);
    return { packPath: 'cars/racers.rpk', entry: entries.find(entry => entry.typeId === id)! } as any;
  };
  const source = await vehicleLight(assets, 'cars/racers/Einvagen.rpk', 8);
  assert.deepEqual(source!.beam, { horizontal: 'horizontal.dds', vertical: 'vertical.png',
    color: [0.7, 0.8, 0.9], range: 800, innerCone: 0.896 });
  assert.ok(packs.slice(1).every(pack => pack === 'cars/racers.rpk'));
});


test('only switched lamp overlays emit their texture; the unlit base lens stays unchanged', () => {
  const texture = new Texture();
  const lens = new MeshStandardMaterial({ map: texture });
  const switched = new MeshStandardMaterial({ map: texture });
  const group = new Group(); const overlay = new Group();
  group.add(new Mesh(undefined, lens), overlay); overlay.add(new Mesh(undefined, switched));
  configureCfgLampEmission(group, 0);
  assert.equal(lens.emissive.getHex(), 0);
  configureCfgLampEmission(overlay, 4);
  assert.equal(switched.emissiveMap, texture);
  assert.equal(switched.emissive.getHex(), 0xffffff);
  assert.ok(switched.emissiveIntensity > 1);
  assert.equal(lens.emissiveMap, null); assert.equal(lens.emissive.getHex(), 0);
  overlay.userData.lightFlags = 4;
  applyCfgRenderChannels(group, 0); assert.equal(overlay.visible, false);
  applyCfgRenderChannels(group, 4); assert.equal(overlay.visible, true);
  texture.dispose(); lens.dispose(); switched.dispose();
});

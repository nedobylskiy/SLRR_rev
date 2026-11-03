import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePartConfig, secondaryRenders } from '../src/formats/cfg';
import { cfgRenderVisible, applyCfgRenderChannels } from '../src/render/vehicle-lights';

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

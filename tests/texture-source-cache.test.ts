import test from 'node:test';
import assert from 'node:assert/strict';
import { RepeatWrapping, Texture } from 'three';
import { Assets } from '../src/assets';
import { AssetTextureSources, TextureSourceCache } from '../src/render/texture-source-cache';

test('map textures share pixels, keep independent transforms, and release after the last user', async () => {
  const cache = new TextureSourceCache(), source = new Texture();
  let loads = 0, releases = 0;
  source.addEventListener('dispose', () => releases++);
  const load = async () => { loads++; return source; };
  const [a,b] = await Promise.all([cache.acquire('road',load),cache.acquire('road',load)]);
  assert.equal(loads,1);
  assert.equal(a.source,b.source);
  assert.notEqual(a,b);
  a.offset.set(.5,.25);assert.equal(b.offset.x,0);
  a.dispose();a.dispose();assert.equal(releases,0);
  const c=await cache.acquire('road',load);assert.equal(loads,1);
  b.dispose();assert.equal(releases,0);
  c.dispose();assert.equal(releases,1);
  const d=await cache.acquire('road',load);assert.equal(loads,2);d.dispose();
});

test('failed map texture loads can be retried', async () => {
  const cache=new TextureSourceCache();
  await assert.rejects(cache.acquire('missing',async()=>{throw new Error('missing');}));
  const texture=await cache.acquire('missing',async()=>new Texture());texture.dispose();
});

test('vehicle sources share normalized paths within one asset collection and isolate other collections', async () => {
  const cache = new AssetTextureSources();
  const first = new Assets([], async () => new Uint8Array()), second = new Assets([], async () => new Uint8Array());
  let loads = 0;
  const load = async () => { loads++; return new Texture(); };
  const [paint, otherPart, otherCollection] = await Promise.all([
    cache.acquire(first, 'Cars\\Textures\\Paint.PNG', load),
    cache.acquire(first, './cars/textures/paint.png', load),
    cache.acquire(second, 'cars/textures/paint.png', load),
  ]);
  assert.equal(loads, 2);
  assert.equal(paint.source, otherPart.source);
  assert.notEqual(paint.source, otherCollection.source);
  paint.repeat.set(2, 3); paint.wrapS = RepeatWrapping;
  assert.equal(otherPart.repeat.x, 1);
  assert.notEqual(paint.wrapS, otherPart.wrapS, 'material samplers remain independent');
  paint.dispose();
  const laterCar = await cache.acquire(first, 'cars/textures/paint.png', load);
  assert.equal(loads, 2, 'removing one car retains the source used by other parts');
  assert.equal(laterCar.source, otherPart.source);
  otherPart.dispose(); laterCar.dispose(); otherCollection.dispose();
  const replacement = await cache.acquire(first, 'cars/textures/paint.png', load);
  assert.equal(loads, 3, 'the last release evicts the decoded source');
  replacement.dispose();
});

test('new scene pools do not join in-flight vehicle texture requests from the old scene', async () => {
  const assets = new Assets([], async () => new Uint8Array());
  const oldScene = new AssetTextureSources(), newScene = new AssetTextureSources();
  let finish!: (texture: Texture) => void;
  const pending = oldScene.acquire(assets, 'paint.png', () => new Promise(resolve => { finish = resolve; }));
  const current = await newScene.acquire(assets, 'paint.png', async () => new Texture());
  const oldSource = new Texture(); let releases = 0;
  oldSource.addEventListener('dispose', () => releases++);
  finish(oldSource);
  const stale = await pending;
  stale.dispose(); assert.equal(releases, 1);
  const sibling = await newScene.acquire(assets, 'paint.png', async () => { throw Error('unexpected reload'); });
  assert.equal(current.source, sibling.source);
  current.dispose(); sibling.dispose();
});

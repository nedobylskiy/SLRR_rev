import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'three';
import { TextureSourceCache } from '../src/render/texture-source-cache';

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

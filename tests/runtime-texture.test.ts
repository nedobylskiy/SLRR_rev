import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { Assets } from '../src/assets';
import { entryProperties } from '../src/formats/rpk';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';

test('file-created textures retain identity through Java IDs and resolve lazily for OSD', async () => {
  let reads = 0;
  const assets = new Assets([{ path: 'decals/test.png', size: 3 }], async () => { reads++; return new Uint8Array([1, 2, 3]); });
  const identity = assets.registerTexture('decals\\test.png');
  assert.deepEqual(assets.registerTexture('DECALS/test.png'), identity);
  assert.equal(reads, 0);
  assert.throws(() => assets.registerTexture('decals/missing.png'), /missing/);
  const catalog = new ResourceCatalog([]);
  catalog.registerTexture(identity.pack, identity.id, 'decals/test.png');
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {}, undefined, catalog);
  const ref = () => jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  const decal = ref();
  resources.bindTexture(decal, identity);
  const id = jvm.natives.invoke('java.util.resource.ResourceRef', 'id', decal, [])!;
  assert.notEqual(id.value, 0);
  assert.equal(jvm.natives.invoke('java.util.resource.ResourceRef', 'type', decal, [])!.value, 7);
  const copied = ref();
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', copied, [jv('int', id.value)]);
  assert.equal(resources.getResource(copied)?.resourcePack, identity.pack);
  await jvm.natives.invokeAsync('java.util.resource.ResourceRef', 'load', copied, []);
  assert.deepEqual(resources.resolveResourceIdentity(Number(id.value)), identity);
  // Rectangle replacement code carries a pack and the low 16 bits of the RID.
  const texture = await assets.resource(identity.pack, Number(id.value) & 0xffff);
  const source = entryProperties(texture.entry).find(prop => prop.key === 'sourcefile')!.value;
  assert.equal(source, 'decals/test.png');
  assert.equal(reads, 0, 'binding and resolving a texture must not decode or read all images');
  assert.deepEqual(await assets.read(source), new Uint8Array([1, 2, 3]));
  assert.equal(reads, 1);
  resources.dispose();
});

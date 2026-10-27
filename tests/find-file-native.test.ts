import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { Assets } from '../src/assets';
import { AssetCatalogAdapter, FindFileNative } from '../src/runtime/find-file-native';
import { MemoryKeyValue } from '../src/runtime/key-value';
import { VirtualFileSystem } from '../src/runtime/virtual-file-system';

test('FindFile searches virtual files before installation catalog and returns basenames', async () => {
  const paths = ['parts/engines/stock.rpk', 'parts/engines/extra.rpk',
    'parts/engines/info.txt', 'multibot/maps/TrackA/road.rpk', 'multibot/maps/TrackB/road.rpk'];
  const assets = new Assets(paths.map(path => ({ path, size: 0 })), async () => new Uint8Array());
  const fs = await VirtualFileSystem.load(new MemoryKeyValue());
  for (const path of paths) fs.indexOriginalPath(path);
  fs.write('parts/engines/custom.rpk', new Uint8Array([1]));
  assert.equal(fs.delete('parts/engines/stock.rpk'), true);
  const jvm = new SlrrJvm({ resolveImport: () => null });
  new FindFileNative(jvm, fs, new AssetCatalogAdapter(assets));
  const finder = jv('FindFile', { className: 'java.io.FindFile', fields: new Map([
    ['handle', jv('int', -1)], ['flags', jv('int', 0)],
  ]) });
  const call = (name: string, ...args: ReturnType<typeof jv>[]) =>
    jvm.natives.invoke('java.io.FindFile', name, finder, args)?.value;
  assert.equal(call('first', jv('String', 'parts\\engines\\*.rpk'), jv('int', 1)), 'custom.rpk');
  assert.equal(call('next'), 'extra.rpk');
  assert.equal(call('next'), null);
  assert.equal(call('next'), null);
  assert.equal(call('first', jv('String', 'multibot/maps/*'), jv('int', 2)), 'TrackA');
  assert.equal(call('next'), 'TrackB');
  assert.equal(call('next'), null);
  call('close');
  assert.equal(jvm.get(finder, 'handle').value, -1);
  assert.equal(call('next'), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { parseSdat, serializeSdat } from '../src/formats/sdat';
import { FileNative } from '../src/runtime/file-native';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { MemoryKeyValue } from '../src/runtime/key-value';
import { MemoryFile } from '../src/runtime/memory-file';
import { VirtualFileSystem } from '../src/runtime/virtual-file-system';

test('writable overlay survives reloading a replaceable KeyValue backend', async () => {
  const backend = new MemoryKeyValue();
  const first = await VirtualFileSystem.load(backend);
  first.mountOriginal('save/controls/defaults', new Uint8Array([1, 2]));
  first.write('save/controls/active_control_set', new Uint8Array([3, 4]));
  assert.equal(first.copy('save/controls/defaults', 'save/controls/copy'), true);
  assert.equal(first.delete('save/controls/defaults'), true);
  await first.flush();
  const second = await VirtualFileSystem.load(backend);
  second.mountOriginal('save/controls/defaults', new Uint8Array([1, 2]));
  assert.deepEqual(second.read('SAVE\\CONTROLS\\ACTIVE_CONTROL_SET'), new Uint8Array([3, 4]));
  assert.deepEqual(second.read('save/controls/copy'), new Uint8Array([1, 2]));
  assert.equal(second.exists('save/controls/defaults'), false);
  assert.equal(second.move('save/controls/copy', 'save/controls/moved'), true);
  await second.flush();
  assert.equal((await VirtualFileSystem.load(backend)).exists('save/controls/copy'), false);
});

test('Java File reads original SDAT and writes a persistent SDAT stream', async () => {
  const backend = new MemoryKeyValue(), fs = await VirtualFileSystem.load(backend);
  const original = new MemoryFile();
  original.writeInt(1280463939); original.writeInt(16); original.writeString('SysKeyboard');
  fs.mountOriginal('save/controls/active_control_set', serializeSdat({ type: 2, flags: 0,
    payload: original.toBytes(), packs: new Map(), unsaved: [] }));
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  new FileNative(jvm, fs, resources);
  const file = (name: string): JavaValue => jv('File', { className: 'java.io.File',
    fields: new Map([['name', jv('String', name)]]) });
  const call = (name: string, target: JavaValue, ...args: JavaValue[]) =>
    jvm.natives.invoke('java.io.File', name, target, args)?.value;
  const reader = file('save/controls/active_control_set');
  assert.equal(call('open', reader, jv('int', 0)), 1);
  assert.equal(call('readInt', reader), 1280463939);
  assert.equal(call('readInt', reader), 16);
  assert.equal(call('readString', reader), 'SysKeyboard');
  call('close', reader);
  const writer = file('save/test/custom');
  assert.equal(call('open', writer, jv('int', 1)), 1);
  assert.equal(call('write', writer, jv('int', 42)), 4);
  assert.equal(call('write', writer, jv('float', 1.25)), 4);
  assert.equal(call('write', writer, jv('String', 'hello')), 6);
  call('close', writer);
  await fs.flush();
  const stored = (await VirtualFileSystem.load(backend)).read('save/test/custom')!;
  assert.deepEqual([...stored.subarray(0, 8)], [83, 68, 65, 84, 0, 1, 2, 0]);
  const payload = parseSdat(stored).payload;
  const values = new MemoryFile(payload);
  assert.equal(values.readInt(), 42);
  assert.equal(values.readFloat(), 1.25);
  assert.equal(values.readString(), 'hello');
  const klass = jv('class', 'java.io.File');
  assert.equal(call('exists', klass, jv('String', 'save/test/custom')), 1);
  assert.equal(call('copy', klass, jv('String', 'save/test/custom'), jv('String', 'save/test/copy')), 0);
  assert.equal(call('move', klass, jv('String', 'save/test/copy'), jv('String', 'save/test/moved')), 0);
  assert.equal(call('delete', klass, jv('String', 'save/test/moved')), 0);
  assert.equal(call('exists', klass, jv('String', 'save/test/moved')), 0);
});

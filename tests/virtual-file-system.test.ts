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

test('Java File remounts ResourceRefs across persistence and different runtime ID assignments', async () => {
  const backend = new MemoryKeyValue(), fs = await VirtualFileSystem.load(backend);
  const setup = (files: VirtualFileSystem, swapped = false) => {
    const jvm = new SlrrJvm({ resolveImport: () => null });
    const resources = new GameTypeNative(jvm, () => {}, undefined, undefined, undefined, undefined,
      id => id === 0x30002a ? { pack: swapped ? 'cars.rpk' : 'frontend.rpk', id: 0x2a } : undefined);
    new FileNative(jvm, files, resources);
    const file = (path: string) => jv('File', { className: 'java.io.File', fields: new Map([['name', jv('String', path)]]) });
    const call = (method: string, receiver: JavaValue, ...args: JavaValue[]) => jvm.natives.invoke('java.io.File', method, receiver, args)!;
    const ref = (id: JavaValue) => {
      const value = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
      jvm.natives.invoke('java.util.resource.ResourceRef', 'set', value, [id]);
      return value;
    };
    return { resources, file, call, ref };
  };
  const first = setup(fs), writer = first.file('save/career/test/player');
  first.call('open', writer, jv('int', 1));
  const frontend = first.ref(jv('int', 0x30002a));
  const carId = jv('int', 0x50002a); carId.resource = { pack: 'CARS', id: 0x2a };
  const car = first.ref(carId);
  first.call('write', writer, jv('int', 123));
  for (const value of [frontend, car, frontend, jv('ResourceRef', null)])
    assert.equal(first.call('write', writer, value).value, 4);
  first.call('close', writer); await fs.flush();
  const reloaded = await VirtualFileSystem.load(backend), saved = parseSdat(reloaded.read('save/career/test/player')!);
  assert.deepEqual([...saved.packs], [[1, 'frontend.rpk'], [2, 'cars.rpk']]);
  const wire = new MemoryFile(saved.payload);
  assert.deepEqual(Array.from({ length: 5 }, () => wire.readInt()), [123, 0x1002a, 0x2002a, 0x1002a, 0]);
  const second = setup(reloaded, true), reader = second.file('save/career/test/player');
  second.call('open', reader, jv('int', 0));
  assert.equal(second.call('readInt', reader).value, 123);
  const ids = Array.from({ length: 4 }, () => second.call('readResID', reader));
  assert.equal(ids[0].value, ids[2].value, 'repeated references share one remounted ID');
  assert.notEqual(ids[0].value, ids[1].value, 'same local ID in two packs stays distinct');
  assert.equal(ids[3].value, 0);
  for (const [index, pack] of [[0, 'frontend.rpk'], [1, 'cars.rpk']] as const) {
    // Deliberately discard JavaValue metadata, as scripts store readResID in int fields.
    const resource = second.resources.getResource(second.ref(jv('int', ids[index].value)))!;
    assert.deepEqual(second.resources.resolveRenderResource(resource), { pack, id: 0x2a });
  }
  const copy = second.file('save/career/test/copy');
  second.call('open', copy, jv('int', 1));
  second.call('write', copy, second.ref(jv('int', ids[1].value)));
  second.call('close', copy);
  assert.deepEqual([...parseSdat(reloaded.read('save/career/test/copy')!).packs], [[1, 'cars.rpk']]);
});

test('File.readResID rejects missing and unsupported embedded resources instead of using runtime IDs', async () => {
  const fs = await VirtualFileSystem.load(new MemoryKeyValue());
  const jvm = new SlrrJvm({ resolveImport: () => null });
  new FileNative(jvm, fs, new GameTypeNative(jvm, () => {}));
  for (const type of [1, 2]) {
    const payload = new MemoryFile(); payload.writeInt(0x1002a);
    fs.write('save/ref', serializeSdat({ type, flags: 0, payload: payload.toBytes(), packs: new Map([[1, 'cars.rpk']]), unsaved: [] }));
    const file = jv('File', { className: 'java.io.File', fields: new Map([['name', jv('String', 'save/ref')]]) });
    jvm.natives.invoke('java.io.File', 'open', file, [jv('int', 0)]);
    assert.deepEqual(jvm.natives.invoke('java.io.File', 'readResID', file, [])!.resource, { pack: 'cars.rpk', id: 0x2a });
  }
  for (const [id, pattern] of [[0x2002a, /missing pack ordinal/], [0xffff0001, /embedded SDAT/]] as const) {
    const payload = new MemoryFile(); payload.writeInt(id);
    fs.write('save/ref', serializeSdat({ type: 2, flags: 0, payload: payload.toBytes(), packs: new Map(), unsaved: [] }));
    const file = jv('File', { className: 'java.io.File', fields: new Map([['name', jv('String', 'save/ref')]]) });
    jvm.natives.invoke('java.io.File', 'open', file, [jv('int', 0)]);
    assert.throws(() => jvm.natives.invoke('java.io.File', 'readResID', file, []), pattern);
  }
});

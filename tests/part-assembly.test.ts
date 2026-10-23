import test from 'node:test';
import assert from 'node:assert/strict';
import { PartAssemblyRuntime } from '../src/runtime/part-assembly';
import { jv, parseSourceClass } from '../src/runtime/java-source';
import { parseSdat, serializeSdat } from '../src/formats/sdat';

// Authored synthetic programs, not redistributed game sources. They deliberately use
// a different payload from SLRR so passing proves execution, not a hard-coded serializer.
const part = `class Part {
  final static int SAVEFILEVERSION_PART = 3;
  public static Part createFromFile(File f, GameRef world) {
    int resource = f.readResID(); int version = f.readInt();
    GameRef factory = new GameRef();
    Part result = factory.create(world, new GameRef(resource), "", "");
    result.file_ver = version; result.load(f); return result;
  }
  public void save(File f) {
    f.write(new GameRef(getInfo(GII_TYPE))); f.write(SAVEFILEVERSION_PART);
    f.write(getWear()); f.write(getTear());
    for (int i=0; i<getSlots(); i++) {
      int slot=getSlotID(i); int other=slotIDOnSlot(slot);
      if (other) { f.write(slot); f.write(other); Part child=partOnSlot(slot); child.save(f); }
    }
    f.write(-1);
  }
  public void load(File f) {
    setWear(f.readFloat()); setTear(f.readFloat()); int slot;
    while ((slot=f.readInt())!=-1) {
      int own=f.readInt(); Part child=Part.createFromFile(f,getParent());
      child.command("install 0 "+id()+" "+own+" "+id()+" "+slot);
    }
  }
}`;
const custom = `class Custom extends Part {
 public void save(File f) { super.save(f); f.write(setting); f.write(123); }
 public void load(File f) { super.load(f); setting=f.readFloat(); int marker=f.readInt(); if(marker!=123) setting=0.0; }
}`;
function setup() {
  const runtime = new PartAssemblyRuntime(); runtime.registerSource(part); runtime.registerSource(custom);
  runtime.registerDefinition({ resource: { pack: 'test/root.rpk', localId: 6 }, className: 'Custom', slots: [100, 101], fields: { setting: jv('float', 0) } });
  runtime.registerDefinition({ resource: { pack: 'test/child.rpk', localId: 7 }, className: 'Custom', slots: [1], fields: { setting: jv('float', 0) } });
  const world = runtime.createWorld(), root = world.create({ pack: 'test/root.rpk', localId: 6 }), child = world.create({ pack: 'test/child.rpk', localId: 7 }); world.root = root;
  world.attach(root, 100, child, 1); root.setFloat('setting', 2.5); child.setFloat('setting', 7.125); root.wear = Math.fround(0.8); child.tear = Math.fround(0.6);
  return { runtime, world, root, child };
}
test('parsed source drives recursion, super dispatch, typed File.write and restoration', () => {
  const { runtime, world, root } = setup(); const bytes = runtime.serialize(root);
  const sdat = parseSdat(bytes); assert.equal(sdat.packs.size, 2);
  assert.equal(new DataView(sdat.payload.buffer).getFloat32(8, true), Math.fround(0.8)); // getWear -> float overload
  const restored = runtime.restore(bytes);
  assert.deepEqual(runtime.serialize(restored.root!), bytes);
  assert.equal(restored.root!.fields.get('setting')!.value, 2.5);
  assert.equal(restored.root!.slots[0].child!.fields.get('setting')!.value, 7.125);
  assert.notEqual(restored.root, root); restored.root!.slots[0].child!.setFloat('setting', 9);
  assert.equal(root.slots[0].child!.fields.get('setting')!.value, 7.125);
  world.dispose(); restored.dispose(); assert.deepEqual(runtime.liveCounts, { worlds: 0, parts: 0, resources: 0 });
});
test('late decode failure rolls back all staged parts and preserves replacement world', () => {
  const { runtime, world, root } = setup(), bytes = runtime.serialize(root), before = { ...runtime.liveCounts };
  const sdat = parseSdat(bytes); sdat.payload = new Uint8Array([...sdat.payload, 1]);
  assert.throws(() => runtime.restore(serializeSdat(sdat), world), /Unconsumed/);
  assert.deepEqual(runtime.liveCounts, before); assert.equal(world.disposed, false); assert.deepEqual(runtime.serialize(root), bytes);
  const badResource = parseSdat(bytes); badResource.packs.set(2, 'missing.rpk');
  assert.throws(() => runtime.restore(serializeSdat(badResource), world), /Missing part definition/);
  assert.deepEqual(runtime.liveCounts, before);
  const replaced = runtime.restore(bytes, world); assert.equal(world.disposed, true); assert.equal(replaced.parts.size, 2);
  assert.throws(() => root.setFloat('setting', 1), /Stale/); replaced.dispose();
});
test('limits and numeric validation fail without leaking worlds or changing originals', () => {
  const { runtime, world, root } = setup(), bytes = runtime.serialize(root), before = { ...runtime.liveCounts };
  const sdat = parseSdat(bytes); new DataView(sdat.payload.buffer).setFloat32(8, NaN, true);
  assert.throws(() => runtime.restore(serializeSdat(sdat), world), /finite/i);
  assert.deepEqual(runtime.liveCounts, before);
  for (const length of [0, 4, 8, bytes.length - 1]) assert.throws(() => runtime.restore(bytes.subarray(0, length), world));
  assert.deepEqual(runtime.liveCounts, before); world.dispose();
  const bounded = new PartAssemblyRuntime({ budget: 50 });
  bounded.registerSource(`class Part {public void save(File f){ while(1) {} }}`);
  bounded.registerDefinition({ resource: { pack: 'x.rpk', localId: 1 }, className: 'Part', slots: [] });
  const w = bounded.createWorld(), p = w.create({ pack: 'x.rpk', localId: 1 });
  assert.throws(() => bounded.serialize(p), /budget/); w.dispose();
});
test('source edits change the executed payload; unsupported syntax is rejected', () => {
  const a = setup(), first = a.runtime.serialize(a.root);
  const changed = new PartAssemblyRuntime(); changed.registerSource(part); changed.registerSource(custom.replace('f.write(123)', 'f.write(456)'));
  changed.registerDefinition(a.root.definition); changed.registerDefinition(a.child.definition);
  const copy = changed.restore(first); const second = changed.serialize(copy.root!);
  assert.notDeepEqual(second, first); copy.dispose(); a.world.dispose();
  assert.throws(() => parseSourceClass('class Part { public void save(File f) { throw new Exception(); }}'));
  assert.throws(() => { const r = new PartAssemblyRuntime(); r.registerSource('class A extends B {}'); r.registerSource('class B extends A {}'); }, /cycle/);
});

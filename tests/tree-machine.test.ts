import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeMachine } from '../src/runtime/tree-machine';
import { MemoryFile } from '../src/runtime/memory-file';
import type { TufaClass } from '../src/formats/tufa';
import type { ScriptObject } from '../src/runtime/native-registry';

test('TREE equality uses VM locals and object identity, rejecting unsupported methods', () => {
  const cls: TufaClass = { version: 151453, name: 'test.Object', superName: '', constants: [], sections: [],
    methods: [{ flags: 1, name: 'equals', signature: '(Ltest.Object;)I', tree: 0, localCount: 2 }],
    trees: [[{ op: 1, source: 1, operand: 0, offset: 0 }, { op: 1, source: 1, operand: 1, offset: 7 }, { op: 7, source: 1, operand: 7, offset: 14 }, { op: 40, source: 1, offset: 21 }, { op: 43, source: 1, offset: 24 }]] };
  const machine = new TreeMachine(), obj: ScriptObject = { className: cls.name, fields: new Map() };
  assert.equal(machine.invoke(cls, 'equals', '(Ltest.Object;)I', obj, [obj]), 1);
  assert.equal(machine.invoke(cls, 'equals', '(Ltest.Object;)I', obj, [null]), 0);
  cls.trees[0][0].op = 0x25;
  assert.throws(() => machine.invoke(cls, 'equals', '(Ltest.Object;)I', obj, [obj]), /Unsupported TREE/);
});
test('MemoryFile preserves primitive binary layout, null vs empty, buffer ownership and limits', () => {
  const f = new MemoryFile(); f.writeInt(-123); f.writeFloat(0.5); f.writeString(null); f.writeString(''); f.writeString('café');
  const copy = f.toBytes(), read = new MemoryFile(copy); copy.fill(0);
  assert.equal(read.readInt(), -123); assert.equal(read.readFloat(), 0.5); assert.equal(read.readString(), null); assert.equal(read.readString(), ''); assert.equal(read.readString(), 'café');
  assert.throws(() => read.readInt()); assert.throws(() => new MemoryFile(undefined, 3).writeInt(1));
  assert.throws(() => new MemoryFile().writeString('日本語'));
});

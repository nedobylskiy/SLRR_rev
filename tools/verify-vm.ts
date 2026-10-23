import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { gameRoot } from './game-files';
import { parseTufa } from '../src/formats/tufa';
import { TreeMachine } from '../src/runtime/tree-machine';
import type { ScriptObject } from '../src/runtime/native-registry';

const cls = parseTufa(await readFile(`${gameRoot}/system/scripts/lang/Object.class`))[0];
const machine = new TreeMachine(), a: ScriptObject = { className: cls.name, fields: new Map() }, b: ScriptObject = { className: cls.name, fields: new Map() };
assert.equal(machine.invoke(cls, 'equals', '(Ljava.lang.Object;)I', a, [a]), 1);
assert.equal(machine.invoke(cls, 'equals', '(Ljava.lang.Object;)I', a, [b]), 0);
assert.equal(machine.invoke(cls, 'equals', '(Ljava.lang.Object;)I', a, [null]), 0);
assert.throws(() => machine.invoke(cls, 'runMethod', '(Ljava.lang.String;)I', a, ['test']), /Missing native/);
console.log('Original Object.class: equals(self)=1, equals(other)=0, equals(null)=0; missing runMethod native fails explicitly.');

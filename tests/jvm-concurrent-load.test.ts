import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';

// Free Ride's Shimutshibu Focer RC 300 failed with "Native constructor missing:
// Block(int)": its engine Block_Inline_OHC was constructed while another load
// had registered Block_Inline but not yet loaded its parent Block.
const sources: Record<string, string> = {
  'java.game.parts.Part': 'package java.game.parts; public class Part { int id; public Part(int a) { id = a; } }',
  'java.game.parts.enginepart.Block': 'package java.game.parts.enginepart; import java.game.parts.*; public class Block extends Part { int cylinders; public Block(int a) { super(a); cylinders = 4; } }',
  'java.game.parts.enginepart.block.Block_Inline': 'package java.game.parts.enginepart.block; import java.game.parts.*; import java.game.parts.enginepart.*; public class Block_Inline extends Block { public Block_Inline(int a) { super(a); } }',
  'java.game.parts.enginepart.block.block_inline.Block_Inline_OHC': 'package java.game.parts.enginepart.block.block_inline; import java.game.parts.enginepart.block.*; public class Block_Inline_OHC extends Block_Inline { public Block_Inline_OHC(int a) { super(a); } }',
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function jvmWithSlowBlock() {
  return new SlrrJvm({
    resolveImport: async ({ className }) => {
      if (className === 'java.game.parts.enginepart.Block') await delay(30);
      return sources[className] ? { path: `${className}.java`, source: sources[className] } : null;
    },
    selectMethods: name => name.startsWith('java.game.') ? [name.split('.').at(-1)!] : undefined,
  });
}

test('a class half-loaded by a concurrent load is not constructed before its ancestors exist', async () => {
  const jvm = jvmWithSlowBlock();
  const first = jvm.loadClass('java.game.parts.enginepart.block.Block_Inline');
  await delay(5); // Block_Inline is registered and still waiting for Block.
  await jvm.loadClass('java.game.parts.enginepart.block.block_inline.Block_Inline_OHC');
  const engine = await jvm.constructAsync('java.game.parts.enginepart.block.block_inline.Block_Inline_OHC', [jv('int', 7)]);
  assert.equal(jvm.get(engine, 'cylinders').value, 4);
  assert.equal(jvm.get(engine, 'id').value, 7);
  await first;
});

test('constructAsync waits for a load in flight before running a registered class', async () => {
  const jvm = jvmWithSlowBlock();
  const first = jvm.loadClass('java.game.parts.enginepart.block.Block_Inline');
  await delay(5);
  const engine = await jvm.constructAsync('java.game.parts.enginepart.block.Block_Inline', [jv('int', 3)]);
  assert.equal(jvm.get(engine, 'cylinders').value, 4);
  await first;
});

test('cyclic imports still load', async () => {
  const cyclic: Record<string, string> = {
    'demo.A': 'package demo; import demo.B; public class A { B other; public A() {} }',
    'demo.B': 'package demo; import demo.A; public class B { A other; public B() {} }',
  };
  const jvm = new SlrrJvm({ resolveImport: async ({ className }) => cyclic[className] ? { path: `${className}.java`, source: cyclic[className] } : null });
  await Promise.all([jvm.loadClass('demo.A'), jvm.loadClass('demo.B')]);
  assert.ok(await jvm.constructAsync('demo.A', []));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from 'slrr-jvm-compiler';
import { parseTufa } from 'slrr-jvm-decompiler';
import { tufaClassName } from '../src/formats/tufa-class-name';
import { bootGame } from '../src/runtime/game-boot';
import { Assets } from '../src/assets';

function staleDialog() {
  const compiled=compileSource('package obsolete; class Dialog { public Dialog() {} }');
  assert.equal(compiled.ok,true,compiled.diagnostics.join('\n'));
  const bytes=compiled.bytes, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  // Add an obsolete constant kind after the declared identity. It is irrelevant
  // to import probing, while the full current decompiler must still reject it.
  const size=view.getUint32(16,true),end=20+size,result=new Uint8Array(bytes.length+4);
  result.set(bytes.subarray(0,end));result.set(bytes.subarray(end),end+4);
  const out=new DataView(result.buffer);
  out.setUint32(16,size+4,true);out.setUint32(20,view.getUint32(20,true)+1,true);
  out.setUint32(end,2,true);
  return result;
}

test('TUFA identity probe stops before obsolete constants in an unrelated class',()=>{
  const bytes=staleDialog();
  assert.equal(tufaClassName(bytes),'obsolete.Dialog');
  assert.throws(()=>parseTufa(bytes),/unknown constant kind/);
  assert.throws(()=>tufaClassName(bytes.subarray(0,12)),/CONS\/CLSS/);
});

test('wildcard imports skip stale Dialog.class and load the declared dialog package',async()=>{
  const proper=compileSource('package java.render.osd.dialog; class Dialog { public Dialog() {} }');
  assert.equal(proper.ok,true,proper.diagnostics.join('\n'));
  const source=`package java.game; import java.render.osd.*; import java.render.osd.dialog.*;
    class Init extends GameType { Init(int id) { Dialog dialog=new Dialog(); reachedCorrectDialog(); } }`;
  const files=new Map<string,Uint8Array>([
    ['sl/scripts/game/src/Init.java',new TextEncoder().encode(source)],
    ['system/scripts/render/osd/Dialog.class',staleDialog()],
    ['system/scripts/render/osd/dialog/Dialog.class',proper.bytes],
  ]);
  const assets=new Assets([...files].map(([path,data])=>({path,size:data.length})),async path=>files.get(path)!);
  const result=await bootGame(assets,()=>{});
  try { assert.match(result.error?.message??'',/reachedCorrectDialog/); }
  finally { result.dispose(); }
});

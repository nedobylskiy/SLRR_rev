import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from 'slrr-jvm-compiler';
import { Assets } from '../src/assets';
import { resourceScriptFile } from '../src/runtime/resource-script-file';

function fixture() {
  const data=new Map<string,Uint8Array>();
  for(const pkg of ['wrong','accessories']) {
    const compiled=compileSource(`package java.game.parts.${pkg}; class stock_Battery_black { public stock_Battery_black() {} }`);
    assert.equal(compiled.ok,true,compiled.diagnostics.join('\n'));
    data.set(`parts/${pkg}/scripts/stock_Battery_black.class`,compiled.bytes);
  }
  const assets=new Assets([...data].map(([path,bytes])=>({path,size:bytes.length})),async path=>data.get(path)!);
  const classes=new Map([['stock_battery_black.class',[...data.keys()]]]);
  return {assets,classes,data};
}

test('saved qualified part names find compiled scripts by namespace and ignore case',async()=>{
  const {assets,classes}=fixture();
  assert.equal((await resourceScriptFile(assets,'java.game.parts.accessories.stock_battery_black',new Map(),classes)).path,
    'parts/accessories/scripts/stock_Battery_black.class');
  await assert.rejects(()=>resourceScriptFile(assets,'java.game.parts.missing.stock_battery_black',new Map(),classes),/source missing/);
});

test('RPK file paths use compiled scripts, preferring installed Java sources',async()=>{
  const {assets,classes,data}=fixture();
  const script='parts/accessories/scripts/stock_Battery_black.class';
  assert.equal((await resourceScriptFile(assets,script,new Map(),classes)).path,script);
  const path='parts/accessories/scripts/src/stock_Battery_black.java';
  const bytes=new TextEncoder().encode('package java.game.parts.accessories; class stock_Battery_black {}');
  assets.byPath.set(path.toLowerCase(),{path,size:bytes.length});data.set(path,bytes);
  const sources=new Map([['stock_battery_black.java',[path]]]);
  assert.equal((await resourceScriptFile(assets,script,sources,classes)).path,path);
  assert.equal((await resourceScriptFile(assets,'java.game.parts.accessories.stock_battery_black',sources,classes)).path,path);
});

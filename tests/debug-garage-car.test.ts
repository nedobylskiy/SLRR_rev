import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';
import type { BootResult } from '../src/runtime/game-boot';
import type { Assets } from '../src/assets';
import { replaceGarageCarTree } from '../src/runtime/debug-garage-car';

async function fixture() {
  const sources: Record<string,string> = {
    'java.game.GameLogic': 'package java.game; class GameLogic { static Garage actualState; static Player player; }',
    'java.game.GameRef': 'package java.game; class GameRef {}',
    'java.game.Player': 'package java.game; class Player extends GameRef { Vehicle car; }',
    'java.game.Garage': 'package java.game; class Garage { native void lockCar(); void refreshCarClassString() {} }',
    'java.game.Vehicle': `package java.game; class Vehicle { Object chassis; int destroyed;
      Vehicle(GameRef parent,int id,int color,float optical,float power,float wear,float tear) { chassis = parent; }
      void destroy() { destroyed=1; } }`,
  };
  const jvm = new SlrrJvm({resolveImport:({className})=>sources[className] ? {path:className+'.java',source:sources[className]} : null});
  for (const name of Object.keys(sources)) await jvm.loadClass(name);
  await jvm.globalAsync('java.game.GameLogic');
  const player = await jvm.constructAsync('java.game.Player',[]), garage = await jvm.constructAsync('java.game.Garage',[]);
  const previous = await jvm.constructAsync('java.game.Vehicle',[player,jv('int',1),jv('int',0),...Array.from({length:4},()=>jv('float',1))]);
  const logic = jv('class','java.game.GameLogic'); jvm.set(logic,'player',player); jvm.set(logic,'actualState',garage); jvm.set(player,'car',previous);
  let locks = 0, fail = false;
  jvm.natives.register('java.game.Garage','lockCar',[],()=>{ locks++; if(fail && locks===1)throw Error('placement failed'); return jv('void',undefined); });
  const text = 'script cars\\racers\\Einvagen_data\\scripts\\Einvagen_110_GTK.class\nnative car chassis.cfg';
  const assets = {pack:async()=>({entries:[{typeId:274,data:new TextEncoder().encode(text)}]})} as unknown as Assets;
  const result = {jvm,gameTypes:{remountSavedResource:(pack:string,id:number)=>{
    assert.equal(pack,'cars/racers/einvagen.rpk');assert.equal(id,274);return jv('int',274);
  }}} as unknown as BootResult;
  return {jvm,player,previous,result,assets,logic,fail:()=>{fail=true;},locks:()=>locks};
}

test('garage debug action replaces the live stock tree without car-lot or save dependencies',async()=>{
  const f=await fixture(); const car=await replaceGarageCarTree(f.result,f.assets);
  assert.equal(f.jvm.get(f.player,'car').value,car.value);
  assert.equal(f.jvm.get(f.previous,'destroyed').value,1);assert.equal(f.locks(),1);
});

test('failed placement restores the previous live car and relocks it',async()=>{
  const f=await fixture();f.fail();await assert.rejects(replaceGarageCarTree(f.result,f.assets),/placement failed/);
  assert.equal(f.jvm.get(f.player,'car').value,f.previous.value);
  assert.equal(f.jvm.get(f.previous,'destroyed').value,0);assert.equal(f.locks(),2);
});

test('garage replacement is unavailable outside the garage',async()=>{
  const f=await fixture();f.jvm.set(f.logic,'actualState',jv('Garage',null));
  await assert.rejects(replaceGarageCarTree(f.result,f.assets),/Open the garage/);
});

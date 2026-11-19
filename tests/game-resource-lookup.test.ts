import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {GameTypeNative} from '../src/runtime/game-type-native';

test('optional typed null scene references have no native object, while malformed receivers still fail',()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{});
  for(const name of ['Vehicle','GameRef','ResourceRef']){
    assert.equal(types.getResource(jv(name,null)),undefined);
    assert.equal(types.get(jv(name,null)),undefined);
  }
  assert.throws(()=>types.getResource(jv('Vehicle',42)),/not a Java object/);
  const car=jv('Vehicle',{className:'java.game.Vehicle',fields:new Map()});
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',car,[]);
  assert.ok(types.get(car));
  types.get(car)!.destroyed=true;assert.equal(types.get(car),undefined);
});

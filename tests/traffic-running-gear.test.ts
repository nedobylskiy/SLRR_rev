import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineWorld,type PartDefinition} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';
import {trafficWheelIndex} from '../src/engine/traffic-running-gear';

test('rival rotors include wheels and tyres but exclude all strut/shock descendants',()=>{
  const world=new EngineWorld();
  const definition=(id:number,source:string):PartDefinition=>({key:{pack:'test.rpk',id},alias:String(id),cfgPath:`${id}.cfg`,config:parsePartConfig(source)});
  const root=world.create(definition(1,Array.from({length:4},(_,i)=>`type 10 sphere 0.3\nspring 0.29 0.1 0.05\nwheel ${i%2} 0 ${Math.floor(i/2)} 0 0 0 1 0 1 0`).join('\n')+'\n'+[101,102,103,104,201,202,203,204,301,302,303,304].map(type=>`slot 0 0 0 0 0 0 ${type}\nslottype ${type}`).join('\n')));
  for(const type of [101,102,103,104,201,202,203,204,301,302,303,304]){
    const part=world.create(definition(type,'slot 0 0 0 0 0 0 1\nslot 0 0 0 0 0 0 2'));
    world.install(root,type,part,1);
    const child=world.create(definition(type+1000,'slot 0 0 0 0 0 0 1'));
    world.install(part,2,child,1);
    const expected=type<200?type-101:undefined;
    assert.equal(trafficWheelIndex(part,root),expected);assert.equal(trafficWheelIndex(child,root),expected);
  }
  assert.equal(trafficWheelIndex(root,root),undefined);world.dispose();
});

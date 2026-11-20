import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,SphereGeometry,type BufferGeometry} from 'three';
import {simplifyLod,type LodSection} from '../src/render/lod-simplify';

const section=(geometry:BufferGeometry,offset=0):LodSection=>{
  const attributes:LodSection['attributes']={};
  for(const [name,a] of Object.entries(geometry.attributes)){
    const array=new Float32Array(a.array as ArrayLike<number>);
    if(name==='position')for(let i=0;i<array.length;i+=3)array[i]+=offset;
    attributes[name]={array,itemSize:a.itemSize};
  }
  return {index:new Uint32Array(geometry.index!.array),attributes};
};

test('LOD meets the triangle budget with indices into the original vertices',async()=>{
  const sphere=new SphereGeometry(1,48,32),source=section(sphere),before=source.index.slice();
  const result=await simplifyLod([source],{ratio:.25,mode:'quality'});
  const share=result.triangles/result.sourceTriangles;
  assert.ok(share>.2&&share<.3,`bisection should land near the requested budget: ${result.triangles} of ${result.sourceTriangles}`);
  const vertices=source.attributes.position.array.length/3;
  assert.ok(result.indices[0].every(i=>i<vertices));
  assert.ok(result.error>0&&result.error<.1);
  assert.deepEqual(source.index,before,'source indices stay untouched');
  sphere.dispose();
});

test('a shared error threshold collapses small parts before a large surface',async()=>{
  const large=new SphereGeometry(10,64,48),small=new SphereGeometry(.2,32,24);
  const sections=[section(large),section(small,30)];
  const result=await simplifyLod(sections,{ratio:.2,mode:'quality'});
  const kept=result.indices.map((index,i)=>index.length/sections[i].index.length);
  assert.ok(kept[1]<kept[0],`small ${kept[1]} vs large ${kept[0]}`);
  large.dispose();small.dispose();
});

test('flat faces split by UV seams reduce toward 12 triangles; sloppy mode reaches aggressive budgets',async()=>{
  const box=new BoxGeometry(1,1,1,8,8,8),source=section(box);
  const full=await simplifyLod([source],{ratio:1,mode:'quality'});assert.equal(full.triangles,full.sourceTriangles);
  const quality=await simplifyLod([source],{ratio:.05,mode:'quality'});
  // Flat faces collapse in steps; the closest step to the 38-triangle budget is accepted.
  assert.ok(quality.triangles>=12&&quality.triangles<=full.sourceTriangles*.08,`${quality.triangles}`);
  const aggressive=await simplifyLod([section(new SphereGeometry(1,48,32))],{ratio:.05,mode:'aggressive'});
  assert.ok(aggressive.triangles<=aggressive.sourceTriangles*.06,`${aggressive.triangles}`);
  box.dispose();
});

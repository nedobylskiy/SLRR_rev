import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferAttribute,BufferGeometry,PlaneGeometry,Vector3,ShaderLib,MeshStandardMaterial} from 'three';
import {splitMapGeometry} from '../src/render/map-geometry-chunks';
import {MapDistanceCutoff} from '../src/render/map-distance-cutoff';

function area(geometry:BufferGeometry){
  const p=geometry.getAttribute('position'),idx=geometry.index;let total=0;
  for(let i=0;i<(idx?.count??p.count);i+=3){
    const [a,b,c]=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j));
    total+=b.sub(a).cross(c.sub(a)).length()/2;
  }return total;
}
test('long triangles clip to cells without holes, preserving UVs, normal and normalized paint attributes',()=>{
  const g=new PlaneGeometry(512,256,1,1);g.rotateX(-Math.PI/2);g.translate(-30,4,-11);
  const p=g.getAttribute('position'),uv=new Float32Array(p.count*2),colors=new Uint8Array(p.count*3);
  for(let i=0;i<p.count;i++){uv[i*2]=(p.getX(i)+286)/512;uv[i*2+1]=(p.getZ(i)+139)/256;colors.set([255,128,0],i*3);}
  g.setAttribute('uv',new BufferAttribute(uv,2));g.setAttribute('slrrBakedUv',new BufferAttribute(uv.slice(),2));
  g.setAttribute('slrrColor',new BufferAttribute(colors,3,true));
  const originals=Array.from(p.array),chunks=splitMapGeometry(g);assert.ok(chunks.length>8);
  assert.ok(Math.abs(chunks.reduce((n,c)=>n+area(c),0)-area(g))<.05);
  for(const chunk of chunks){
    assert.ok(chunk.boundingBox!.max.x-chunk.boundingBox!.min.x<=64.0001);
    assert.ok(chunk.boundingBox!.max.z-chunk.boundingBox!.min.z<=64.0001);
    const cp=chunk.getAttribute('position'),cu=chunk.getAttribute('uv');
    for(let i=0;i<cp.count;i++){
      assert.ok(Math.abs(cu.getX(i)-(cp.getX(i)+286)/512)<1e-6);
      assert.ok(Math.abs(cu.getY(i)-(cp.getZ(i)+139)/256)<1e-6);
      assert.ok(Math.abs(chunk.getAttribute('slrrColor').getY(i)-128/255)<1e-6);
      assert.ok(Math.abs(chunk.getAttribute('normal').getY(i)-1)<1e-6);
      assert.equal(chunk.getAttribute('slrrBakedUv').getX(i),cu.getX(i));
    }
  }
  assert.deepEqual(Array.from(p.array),originals,'source physics/render arrays are not rewritten');
});
test('small geometry stays intact and invalid grid sizes are rejected',()=>{
  const g=new PlaneGeometry(10,10);assert.deepEqual(splitMapGeometry(g),[g]);
  assert.throws(()=>splitMapGeometry(g,0));
});
test('vertical facades exactly on grid boundaries remain complete without duplicate faces',()=>{
  const g=new PlaneGeometry(512,128),chunks=splitMapGeometry(g);
  assert.equal(chunks.length,8);
  assert.ok(Math.abs(chunks.reduce((n,c)=>n+area(c),0)-area(g))<.01);
  for(const chunk of chunks){assert.equal(chunk.boundingBox!.min.z,0);assert.equal(chunk.boundingBox!.max.z,0);}
});
test('exact cutoff uses primary world XZ and discards before material shading',()=>{
  const cutoff=new MapDistanceCutoff(),material=new MeshStandardMaterial();cutoff.configure(material);
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader as any,{} as any);
  assert.equal((shader.uniforms as any).slrrMapCutoffFocus,cutoff.focus);
  assert.match(shader.vertexShader,/instanceMatrix\*slrrCutoffWorld/);
  assert.ok(shader.fragmentShader.indexOf('slrrCutoffDelta)>')<shader.fragmentShader.indexOf('#include <map_fragment>'));
});

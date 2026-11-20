import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Matrix4,Vector3,Euler,MeshBasicMaterial,Texture} from 'three';
import {projectPaintGeometry,maskPaintProjection} from '../src/render/paint-projection';

test('clipping preserves authored paint-mask UVs independently of the decal image UVs',()=>{
  const source=new BufferGeometry();
  source.setAttribute('position',new Float32BufferAttribute([-1,-1,0,1,-1,0,-1,1,0],3));
  source.setAttribute('normal',new Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  source.setAttribute('slrrDetailUv',new Float32BufferAttribute([0,0,1,0,0,1],2));
  const decal=projectPaintGeometry(source,new Matrix4(),new Vector3(),new Euler(),new Vector3(1,1,.5),'slrrDetailUv');
  const p=decal.getAttribute('position'),uv=decal.getAttribute('uv'),mask=decal.getAttribute('slrrPaintCoverageUv');assert.ok(p.count>0);
  for(let i=0;i<p.count;i++){
    assert.ok(Math.abs(p.getX(i))<=.500001&&Math.abs(p.getY(i))<=.500001);
    assert.ok(Math.abs(mask.getX(i)-(p.getX(i)+1)/2)<1e-6);
    assert.ok(Math.abs(mask.getY(i)-(p.getY(i)+1)/2)<1e-6);
    assert.ok(Math.abs(uv.getX(i)-(.5+p.getX(i)))<1e-6);
  }
  source.dispose();decal.dispose();
});

test('opaque atlas details suppress paint without changing the underlying vehicle material',()=>{
  const material=new MeshBasicMaterial(),mask=new Texture();maskPaintProjection(material,mask);
  const shader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>'};
  material.onBeforeCompile(shader as any,{} as any);
  assert.equal(shader.uniforms.slrrPaintCoverage.value,mask);
  assert.match(shader.fragmentShader,/diffuseColor.a \*= 1.0-texture2D/);
  assert.match(shader.fragmentShader,/discard/);assert.match(shader.vertexShader,/slrrPaintCoverageUv/);
  material.dispose();mask.dispose();
});

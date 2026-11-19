import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SphereGeometry,Float32BufferAttribute} from 'three';
import {simplifyPlaygroundGeometry} from '../src/render/playground-simplify';

test('LOD preview reduces triangles, retains UVs and leaves original untouched',()=>{
  const source=new SphereGeometry(1,16,12);source.clearGroups();
  const positions=new Float32Array(source.getAttribute('position').array),indices=new Uint16Array(source.index!.array);
  const reduced=simplifyPlaygroundGeometry(source,.5);
  assert.ok(reduced.index!.count<source.index!.count);
  assert.equal(reduced.getAttribute('uv').count,reduced.getAttribute('position').count);
  assert.ok(reduced.boundingSphere);
  assert.deepEqual(source.getAttribute('position').array,positions);assert.deepEqual(source.index!.array,indices);
  const original=simplifyPlaygroundGeometry(source,1);assert.equal(original.index!.count,source.index!.count);
  source.dispose();reduced.dispose();original.dispose();
});

test('LOD preview preserves unsupported channels by retaining original geometry',()=>{
  const source=new SphereGeometry(1,12,8);source.setAttribute('uv1',new Float32BufferAttribute(new Float32Array(source.getAttribute('position').count*2),2));
  const result=simplifyPlaygroundGeometry(source,.1);
  assert.equal(result.index!.count,source.index!.count);assert.ok(result.hasAttribute('uv1'));
  source.dispose();result.dispose();
});

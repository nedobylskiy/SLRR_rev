import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry } from 'three';
import { applyRenderColor } from '../src/render/render-color';
import {SceneLighting} from '../src/render/scene-lighting';

test('paint-mask RenderRefs tint the body uniform, leaving opaque cap and label texels unmodulated',()=>{
  const material=new MeshStandardMaterial({color:0xffffff}),root=new Group();
  new SceneLighting().configureMaterial(material,true,true);
  const geometry=new BoxGeometry(),mesh=new Mesh(geometry,material);root.add(mesh);
  applyRenderColor(root,0xffff9900);
  assert.equal(mesh.material.color.getHex(),0xffffff,'opaque atlas regions retain their authored color');
  const shader={uniforms:{} as Record<string,{value:any}>,vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <opaque_fragment>'};
  mesh.material.onBeforeCompile(shader as any,{} as any);
  assert.equal(shader.uniforms.slrrPaintColor.value.getHex(),0xff9900);
  assert.match(shader.fragmentShader,/sampledDiffuseColor.a/,'retain the original alpha coverage shader after cloning');
  assert.equal(material.userData.slrrPaintColor[0],1,'shared source material retains its paint state');
  assert.equal(mesh.material.opacity,1);
  mesh.material.dispose();material.dispose();geometry.dispose();
});

test('RenderRef ARGB tint is instance-local and preserves source opacity', () => {
  const material = new MeshStandardMaterial({color:0xffffff,opacity:.5});
  const geometry = new BoxGeometry(), root = new Group();
  const mesh = new Mesh(geometry,material);root.add(mesh);
  applyRenderColor(root,0x80ff0000);
  assert.notEqual(mesh.material,material);
  assert.equal(mesh.material.color.getHex(),0xff0000);
  assert.ok(Math.abs(mesh.material.opacity - .5 * 128 / 255)<1e-8);
  assert.equal(mesh.material.transparent,true);
  assert.equal(material.color.getHex(),0xffffff);
  assert.equal(material.opacity,.5);
  mesh.material.dispose();material.dispose();geometry.dispose();
});

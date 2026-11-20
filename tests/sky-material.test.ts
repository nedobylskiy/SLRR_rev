import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,ShaderLib,Texture,BoxGeometry,type WebGLRenderer} from 'three';
import {skyMaterial} from '../src/render/sky-material';
import {applyRenderColor} from '../src/render/render-color';

test('sky uses an unlit texture with authored alpha and only explicit horizon fog',()=>{
  const map=new Texture(),source=new MeshStandardMaterial({map,color:0xffffff,transparent:true,opacity:.4});
  source.onBeforeCompile=()=>{throw Error('scene lighting must not be inherited by the sky');};
  const fog=new Color(0x8899aa),enabled={value:1},sky=skyMaterial(source,fog,enabled);
  assert.ok(sky instanceof MeshBasicMaterial);assert.equal(sky.map,map);
  assert.equal(sky.opacity,.4);assert.equal(sky.transparent,true);
  assert.equal(sky.toneMapped,false);assert.equal(sky.fog,false);assert.equal(sky.depthWrite,false);
  const shader={vertexShader:ShaderLib.basic.vertexShader,fragmentShader:ShaderLib.basic.fragmentShader,uniforms:{}};
  sky.onBeforeCompile(shader as Parameters<typeof sky.onBeforeCompile>[0],{} as WebGLRenderer);
  assert.match(shader.fragmentShader,/slrrHorizonFog/);assert.doesNotMatch(shader.fragmentShader,/lights_pars_begin|slrrDynamicLighting/);
  const root=new Group(),geometry=new BoxGeometry(),mesh=new Mesh(geometry,sky);root.add(mesh);
  applyRenderColor(root,0x80ffffff);
  assert.notEqual(mesh.material,sky);assert.equal(mesh.material.onBeforeCompile,sky.onBeforeCompile,'Java sky fades retain horizon fog');
  assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.map,map);
  mesh.material.dispose();geometry.dispose();sky.dispose();source.dispose();map.dispose();
});

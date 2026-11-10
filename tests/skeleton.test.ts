import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,MeshStandardMaterial,SkinnedMesh,Vector3} from 'three';
import {parseSkeleton} from '../src/formats/skeleton';
import {createCharacterSkeleton,createSkinGeometry,createOriginalClip,SkinnedCharacter} from '../src/render/skinned-character';
import {parseMatrixData} from '../src/formats/matrixdata';
import {characterFamily,skeletonCompatibility} from '../src/render/character-catalog';
import {parseScx} from '../src/formats/scx';
import {scxModelTransfers} from '../src/formats/scx-worker-protocol';
import type {ScxMesh} from '../src/formats/scx';

const record=(name:string,parent:number,x=0)=>`${name}\n${parent}\n1,0,0\n0,1,0\n0,0,1\n${x},0,0\n-3.14,3.14\n2.6,-2.8\n-3.14,3.14\n`;
test('skeleton parser preserves later parents, forests and wrapped limits but rejects corrupt hierarchies',()=>{
 const defs=parseSkeleton(record('child',1,100)+record('root',-1)+record('second root',-1));
 assert.equal(defs[0].parent,1);assert.deepEqual(defs[0].limits[1],[2.6,-2.8]);
 const rig=createCharacterSkeleton(defs);assert.equal(rig.root.children.length,2);assert.equal(rig.bones[0].parent,rig.bones[1]);assert.equal(rig.bones[0].position.x,1);rig.skeleton.dispose();
 assert.throws(()=>parseSkeleton(record('child',1)+record('root',0)),/cyclic/);
 assert.throws(()=>parseSkeleton(record('child',4)),/outside/);
 assert.throws(()=>parseSkeleton(record('same',-1)+record('same',-1)),/name/);
 assert.throws(()=>parseSkeleton(record('root',-1).replace('1,0,0','NaN,0,0')),/numeric/);
 assert.throws(()=>parseSkeleton('incomplete'),/incomplete/);
});

const u32=(...values:number[])=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeUInt32LE(v,i*4));return b;};
function fixture(local=0){
 const vertex=Buffer.alloc(40);vertex.writeFloatLE(200,0);vertex.writeFloatLE(.25,12);vertex.set([local,1,255,255],16);vertex.writeFloatLE(1,24);
 const parts=[u32(0,20,0,0,0),u32(3,24,0,2,1,0),Buffer.concat([u32(4,56,1,0x265),vertex]),u32(5,12,0)];
 let at=12+parts.length*8;const directory=parts.map((p,i)=>{const row=u32([0,3,4,5][i],at);at+=p.length;return row;});return Buffer.concat([Buffer.from('INVO'),u32(4,parts.length),...directory,...parts]);
}
test('SCX retains section-local palette and residual weights, including worker transfer buffers',()=>{
 const model=parseScx(fixture()),mesh=model.meshes[0];assert.deepEqual([...mesh.bonePalette!],[1,0]);assert.deepEqual([...mesh.boneWeights!],[.25,.75,0,0]);assert.deepEqual([...mesh.boneIndices!],[0,1,255,255]);
 assert.ok(scxModelTransfers(model).includes(mesh.bonePalette!.buffer as ArrayBuffer));assert.ok(scxModelTransfers(model).includes(mesh.boneWeights!.buffer as ArrayBuffer));
 assert.throws(()=>parseScx(fixture(2)),/outside palette/);
});

function character(){
 const defs=parseSkeleton(record('child',1,100)+record('root',-1)),rig=createCharacterSkeleton(defs);
 const character=new SkinnedCharacter(defs,rig.skeleton,rig.root,{pack:'fixture.rpk',id:12,mesh:'fixture.scx',skeleton:'fixture.skl'});
 const source:ScxMesh={name:'skin',positions:new Float32Array([200,0,0,0,0,0,200,0,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),uv:new Float32Array(6),indices:new Uint32Array([0,1,2]),diffuse:[1,1,1,1],textureIndex:0xffff,bonePalette:new Uint32Array([0,1]),boneIndices:new Uint8Array([0,0,0,0,1,0,0,0,0,1,0,0]),boneWeights:new Float32Array([1,0,0,0,1,0,0,0,.5,.5,0,0])};
 const geometry=createSkinGeometry(source,2),mesh=new SkinnedMesh(geometry,new MeshStandardMaterial());character.meshes.push(mesh);character.root.add(mesh);mesh.bind(rig.skeleton,new Matrix4());character.refresh();return {character,mesh,source};
}
test('native Three skin keeps bind pose and rotates only weighted vertices with correct pivot and blend',()=>{
 const {character:ch,mesh,source}=character();assert.ok(ch.deformation().max<1e-7);
 ch.setPose(0,'Z',90);const p=new Vector3();mesh.getVertexPosition(0,p);assert.ok(p.distanceTo(new Vector3(1,1,0))<1e-6);
 mesh.getVertexPosition(1,p);assert.ok(p.length()<1e-7,'unaffected root vertex');
 mesh.getVertexPosition(2,p);assert.ok(p.distanceTo(new Vector3(1.5,.5,0))<1e-6,'half-weight deformation');
 assert.equal(ch.deformation().moved,2);assert.equal(source.positions[0],200,'cached source geometry stays intact');
 ch.setPose(0,'Z',0);assert.ok(ch.deformation().max<1e-7);ch.dispose();
});
test('internal AnimationClip/Mixer moves the bone and can return to the original pose',()=>{
 const {character:ch}=character();ch.setPose(0,'Z',45);ch.animate(true);for(let t=0;t<=1000;t+=50)ch.update(t);assert.ok(ch.deformation().max>.5);
 ch.setPose(0,'Z',0);assert.ok(ch.deformation().max<1e-7);ch.dispose();
});

function animationFixture(){
 const blocks=[u32(2)];
 for(const child of [false,true]){
  const keys=Buffer.alloc(64);
  for(let k=0;k<2;k++){
   const values=[k,0,0,child&&k?Math.SQRT1_2:0,child&&k?Math.SQRT1_2:1,child?1+k:0,0,0];
   values.forEach((v,i)=>keys.writeFloatLE(v,k*32+i*4));
  }
  blocks.push(u32(2),keys);
 }
 return Buffer.concat([...blocks,Buffer.from('root\nchild\n')]);
}
test('matrixdata validates blocks, times, quaternions and named tracks before playback',()=>{
 const data=animationFixture(),animation=parseMatrixData(data);assert.deepEqual([...animation.times],[0,1]);assert.equal(animation.bones[1].name,'child');
 assert.throws(()=>parseMatrixData(data.subarray(0,20)),/key count|Truncated/);
 const bad=Buffer.from(data);bad.writeUInt32LE(3,72);assert.throws(()=>parseMatrixData(bad),/counts/);
 const nan=Buffer.from(data);nan.writeFloatLE(NaN,12);assert.throws(()=>parseMatrixData(nan),/Non-finite/);
 const time=Buffer.from(data);time.writeFloatLE(0,40);assert.throws(()=>parseMatrixData(time),/times/);
 const quaternion=Buffer.from(data);quaternion.writeFloatLE(8,24);assert.throws(()=>parseMatrixData(quaternion),/quaternion/);
});
test('original clip maps names, scales translation, interpolates skin and supports pause, seek, loop and reset',()=>{
 const {character:ch,mesh}=character(),animation=parseMatrixData(animationFixture());
 const clip=createOriginalClip(animation,ch.skeleton,ch.definitions,'walk');assert.equal(clip.tracks.length,4);
 ch.playClip(clip,false);ch.seek(.5);const p=new Vector3();mesh.getVertexPosition(0,p);
 assert.ok(p.distanceTo(new Vector3(1.5+Math.SQRT1_2,Math.SQRT1_2,0))<1e-6,'absolute local key interpolation and centimetres-to-metres length');
 ch.update(0);ch.update(100);assert.equal(ch.playbackTime,.5,'pause preserves time');
 ch.seek(.95);ch.setPlaybackPlaying(true);ch.update(1000);ch.update(1100);assert.ok(Math.abs(ch.playbackTime-.05)<1e-6,'loop wraps');
 ch.playClip(clip,true,false);ch.seek(.95);ch.update(1200);ch.update(1300);assert.equal(ch.playbackTime,1,'non-looping clip holds final pose');
 ch.setPose(0,'Z',0);assert.ok(ch.deformation().max<1e-7,'manual reset restores positions as well as rotations');
 assert.throws(()=>createOriginalClip({...animation,bones:[{...animation.bones[0],name:'missing'},animation.bones[1]]},ch.skeleton,ch.definitions,'bad'),/not in character/);
 ch.dispose();
});

test('animation compatibility compares named hierarchy rather than order, while families keep source folders distinct',()=>{
 const target=parseSkeleton(record('child',1,200)+record('root',-1)),source=parseSkeleton(record('root',-1)+record('child',0,100));
 assert.equal(skeletonCompatibility(target,source),undefined);
 assert.match(skeletonCompatibility(target,[source[0]])!,/count/);
 assert.match(skeletonCompatibility(target,[source[0],{...source[1],name:'other'}])!,/Missing/);
 assert.match(skeletonCompatibility(target,[source[0],{...source[1],parent:-1}])!,/parent/);
 assert.equal(characterFamily('humans\\pedestrians\\Gambler_walk.skl'),characterFamily('humans/pedestrians/gambler_jitter.matrixdata'));
 assert.notEqual(characterFamily('humans/nicelady/betsy.skl'),characterFamily('humans/pedestrians/betsy.matrixdata'));
 const rig=createCharacterSkeleton(target),animation=parseMatrixData(animationFixture());
 const clip=createOriginalClip(animation,rig.skeleton,target,'fit');
 const translation=clip.tracks.find(track=>track.name===`${rig.bones[0].uuid}.position`)!;
 assert.deepEqual([...translation.values],[2,0,0,4,0,0],'transferred local translation follows target length');rig.skeleton.dispose();
});


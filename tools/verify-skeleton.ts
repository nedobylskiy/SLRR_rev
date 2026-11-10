import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Texture,Vector3} from 'three';
import {Assets} from '../src/assets';
import {parseMatrixData} from '../src/formats/matrixdata';
import {parseSkeleton} from '../src/formats/skeleton';
import {loadSkinnedCharacter} from '../src/render/skinned-character';
import {loadCharacterCatalog,skeletonCompatibility} from '../src/render/character-catalog';
import {gameRoot,relativeGamePath,walk} from './game-files';

const files=await walk(gameRoot),assets=new Assets(files.map(file=>({path:relativeGamePath(file),size:0})),async file=>new Uint8Array(await readFile(path.join(gameRoot,file))));
const catalog=await loadCharacterCatalog(assets);let ownClips=0,transfers=0;
for(const model of catalog.models){
  const preview=await loadSkinnedCharacter(assets,async()=>new Texture(),'humans.rpk',model.id);
  try{
    assert.ok(preview.deformation().max<1e-5,`${model.name} bind pose`);
    for(const animation of catalog.animations){
      if(skeletonCompatibility(model.bones,animation.bones))continue;
      const transferred=model.family!==animation.family;
      const {clip}=await preview.loadOriginalClip(assets,animation.id,transferred);preview.playClip(clip,false);preview.seek(clip.duration/2);
      const p=new Vector3();for(const mesh of preview.meshes)for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){
        mesh.getVertexPosition(i,p);assert.ok(p.toArray().every(Number.isFinite)&&p.length()<10,`${model.name} / ${animation.name}: finite metre-space skin`);
      }
      transferred?transfers++:ownClips++;
    }
  }finally{preview.dispose();}
}
console.log(JSON.stringify({models:catalog.models.length,animationResources:catalog.animations.length,ownClips,compatibleTransfers:transfers}));
let animations=0,records=0;
for(const file of files.filter(file=>/\.matrixdata$/i.test(file))){
  const animation=parseMatrixData(new Uint8Array(await readFile(file)));
  const bones=parseSkeleton(await readFile(file.replace(/\.matrixdata$/i,'.bon'),'utf8'));
  assert.deepEqual(animation.bones.map(b=>b.name),bones.map(b=>b.name));
  animations++;records+=animation.bones.length*animation.times.length;
}
const character=await loadSkinnedCharacter(assets,async()=>new Texture(),'humans.rpk',0xa);
try{
  assert.equal(character.definitions.length,25);assert.ok(character.deformation().max<1e-5);
  const {clip,animation,path:source}=await character.loadOriginalClip(assets,0x1c);
  assert.equal(clip.tracks.length,50);assert.equal(animation.times.length,10);
  const sample=(time:number)=>{character.seek(time);const result:number[]=[];const p=new Vector3();
    for(const mesh of character.meshes)for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){mesh.getVertexPosition(i,p);assert.ok(p.toArray().every(Number.isFinite));assert.ok(p.length()<10,'character stays in metre scale');result.push(...p.toArray());}return result;};
  character.playClip(clip,false);const a=sample(0),b=sample(.45);let moved=0,max=0;
  for(let i=0;i<a.length;i+=3){const distance=Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]);if(distance>1e-5)moved++;max=Math.max(max,distance);}
  assert.ok(moved>50,'walk changes weighted vertices');assert.ok(max>.05&&max<2);
  character.setPose(character.bone,'Z',0);assert.ok(character.deformation().max<1e-5,'reset returns original mesh');
  console.log(JSON.stringify({animations,records,source,bones:character.definitions.length,tracks:clip.tracks.length,vertices:a.length/3,movedBetweenFrames:moved,maxMovementMetres:max},null,2));
}finally{character.dispose();}

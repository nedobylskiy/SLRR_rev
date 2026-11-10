import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Texture,Vector3} from 'three';
import {Assets} from '../src/assets';import {SuspensionPlayground} from '../src/render/suspension-playground';import {gameRoot,relativeGamePath,walk,safeGamePath} from './game-files';
const assets=new Assets((await walk(gameRoot)).map(p=>({path:relativeGamePath(p),size:0})),async p=>new Uint8Array(await readFile(await safeGamePath(p))));

const lab=await SuspensionPlayground.create(assets,async()=>new Texture());
try{
 for(const skin of lab.skins){
  assert.ok(Math.abs(skin.span-.245)<1e-6);let mixed=0,rigid=0;
  for(const ratio of [.45,.7,1,1.45]){
   lab.setPose(ratio,0);
   for(const mesh of skin.character.meshes){const p=mesh.geometry.getAttribute('position'),ids=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
    for(let i=0;i<p.count;i++){let upper=0;for(let k=0;k<4;k++)if(ids.getComponent(i,k)===1)upper+=weights.getComponent(i,k);
     const expected=new Vector3().fromBufferAttribute(p,i);expected.y+=upper*skin.span*(ratio-1);const actual=mesh.getVertexPosition(i,new Vector3());assert.ok(actual.distanceTo(expected)<1e-6,`${skin.kind}: original weights move each vertex`);
     if(ratio===1){if(upper>1e-5&&upper<1-1e-5)mixed++;else rigid++;}
    }
   }
   if(ratio===1)assert.ok(skin.difference().max<1e-6,'bind skin matches ordinary mesh');
  }
  lab.setPose(.65,0);console.log(JSON.stringify({kind:skin.kind,bones:skin.character.definitions.map(b=>({name:b.name,parent:b.parent})),mixed,rigid,differenceAt65Percent:skin.difference()}));
  if(skin.kind==='shock')assert.equal(mixed,0);else assert.ok(mixed>0);
 }
 lab.setPose(.8,20);for(const skin of lab.skins)for(const mesh of skin.character.meshes)for(let i=0;i<mesh.geometry.getAttribute('position').count;i++)assert.ok(mesh.getVertexPosition(i,new Vector3()).toArray().every(Number.isFinite));
 lab.setPose(1,0);for(const skin of lab.skins)assert.ok(skin.difference().max<1e-6,'reset restores bind shape');
 console.log('Original suspension BON/SCX skinning, scale comparison, tilt and reset: PASS');
}finally{lab.dispose();}

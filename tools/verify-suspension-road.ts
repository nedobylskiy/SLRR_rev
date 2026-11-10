import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Texture} from 'three';import {SuspensionSkin} from '../src/render/suspension-playground';import {VehicleSuspensionSkin} from '../src/render/vehicle-suspension-skin';import {modelMatrix} from '../src/engine/model-transform';import {poseMatrix} from '../src/engine/transforms';
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Box3,Vector3} from 'three';import {Assets} from '../src/assets';import {PartFactory} from '../src/engine/world';import {parseScx} from '../src/formats/scx';import {SuspensionRoadTest} from '../src/engine/suspension-road-test';import {linkedSuspensionAnchors} from '../src/engine/linked-suspension';import {gameRoot,relativeGamePath,walk,safeGamePath} from './game-files';
const assets=new Assets((await walk(gameRoot)).map(p=>({path:relativeGamePath(p),size:0})),async p=>new Uint8Array(await readFile(await safeGamePath(p))));
const {world,root}=await new PartFactory(assets).stock({pack:'cars/racers/Baiern.rpk',id:6},{mechanical:true});

const model=parseScx(await assets.read(root.definition.model!.path)),bounds=new Box3();for(const mesh of model.meshes)for(let i=0;i<mesh.positions.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(mesh.positions,i).multiplyScalar(.01));
const original=new Map([...world.parts.values()].map(p=>[p,p.local.clone()]));const test=new SuspensionRoadTest(root,bounds),ranges=test.suspension.wheels.map(()=>[Infinity,-Infinity]),spans:number[]=[];
const bindings:VehicleSuspensionSkin[]=[];
try{
 for(const part of world.parts.values()){
  const kind=VehicleSuspensionSkin.kind(part);if(!kind)continue;
  const group=new Group();group.matrixAutoUpdate=false;group.matrix.copy(modelMatrix(part.matrix(),part.definition.config.renderPose?poseMatrix(part.definition.config.renderPose):undefined));
  group.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()));
  const binding=new VehicleSuspensionSkin(part,group,await SuspensionSkin.create(kind,assets,async()=>new Texture()));bindings.push(binding);binding.update();
 }
 assert.equal(bindings.length,8,'all four springs and dampers use stock bone skins');
 for(let tick=0;tick<120*30;tick++){
  test.advance(1/120);assert.ok(test.body.position.toArray().every(Number.isFinite));assert.ok(test.body.position.y>0&&test.body.position.y<3,`body stays supported on the road: tick ${tick}, pos ${test.body.position.toArray()}, orientation ${test.body.orientation.toArray()} omega ${test.body.omega.toArray()}, wheels ${test.suspension.wheels.map(w=>`${w.length}/${w.force}`)}`);
  if(tick%20===0)for(const binding of bindings){
   binding.group.matrix.copy(modelMatrix(binding.part.matrix(),binding.part.definition.config.renderPose?poseMatrix(binding.part.definition.config.renderPose):undefined));binding.update();binding.group.updateMatrixWorld(true);
   const anchors=linkedSuspensionAnchors(root,binding.part)!;
   for(const [i,anchor] of [anchors.lower,anchors.upper].entries()){
    const actual=binding.skin.character.skeleton.bones[i].getWorldPosition(new Vector3()),expected=anchor.applyMatrix4(binding.part.matrix());
    assert.ok(actual.distanceTo(expected)<1e-5,'bone endpoints follow live mounts through proxy cm/render transforms');
   }
  }
  for(const [i,wheel] of test.suspension.wheels.entries()){ranges[i][0]=Math.min(ranges[i][0],wheel.length);ranges[i][1]=Math.max(ranges[i][1],wheel.length);assert.ok(test.wheelPosition(i).toArray().every(Number.isFinite));}
  for(const part of world.parts.values())if(['spring','shock'].includes(part.definition.mechanics?.kind??'')){const a=linkedSuspensionAnchors(root,part);if(a){const span=a.lower.distanceTo(a.upper);assert.ok(span>.025&&span<.735,'bone anchors remain in supported range');spans.push(span);}}
 }
 for(const range of ranges)assert.ok(range[1]-range[0]>.02,'each wheel moves over bumps');
 for(const binding of bindings){
  const matrices=binding.skin.character.skeleton.bones.map(b=>b.matrix.clone());binding.setEnabled(false);assert.equal(binding.skin.character.root.visible,false);assert.equal(binding.group.children[0].visible,true);
  test.advance(1/120);binding.update();binding.skin.character.skeleton.bones.forEach((b,i)=>assert.ok(b.matrix.equals(matrices[i]),'disabled skin does not update bones'));
  binding.setEnabled(true);assert.equal(binding.skin.character.root.visible,true);assert.equal(binding.group.children[0].visible,false);
 }
 const before=root.local.clone();test.paused=true;test.advance(.05);assert.ok(root.local.equals(before),'pause freezes physics');test.paused=false;
 test.reset();test.speed=0;test.terrain.amplitude=0;for(let i=0;i<240;i++)test.advance(1/120);assert.ok(test.suspension.wheels.every(w=>w.contact),'all wheels settle on a flat road');
 console.log(JSON.stringify({seconds:30,wheelTravelMetres:ranges,boneSpanRange:[Math.min(...spans),Math.max(...spans)],flatContacts:test.suspension.wheels.map(w=>w.contact)},null,2));
}finally{for(const binding of bindings){binding.dispose();const mesh=binding.group.children[0] as Mesh;mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}test.dispose();for(const [part,matrix] of original)assert.ok(part.local.equals(matrix),'cleanup restores assembly');world.dispose();}


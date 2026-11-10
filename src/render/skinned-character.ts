import {AnimationClip,AnimationMixer,Bone,BufferAttribute,BufferGeometry,Color,FrontSide,Group,LoopOnce,LoopRepeat,Matrix4,MeshStandardMaterial,Quaternion,QuaternionKeyframeTrack,Skeleton,SkeletonHelper,SkinnedMesh,SRGBColorSpace,Vector3,VectorKeyframeTrack,type AnimationAction,type Texture} from 'three';
import {parseMatrixData,type MatrixAnimation} from '../formats/matrixdata';
import type {Assets} from '../assets';
import {entryProperties} from '../formats/rpk';
import {parseSkeleton,type SkeletonBone} from '../formats/skeleton';
import {parseScxAsync} from '../formats/scx-worker-client';
import type {ScxMesh} from '../formats/scx';
import {skeletonCompatibility} from './character-catalog';
import type {RagdollCar} from '../engine/pedestrian-contact';
import type {RagdollActivation,CharacterRagdoll} from './character-ragdoll';

/** Keys contain absolute local rotations and translations normalized by BON bone length.
 * The length interpretation matches shipped bind keys; it remains a playback inference. */
export function createOriginalClip(animation:MatrixAnimation,skeleton:Skeleton,reference:SkeletonBone[],name:string){
  const tracks=[];const lengths=new Map(reference.map(b=>[b.name,Math.hypot(...b.position)*.01]));
  const targets=new Map(skeleton.bones.map(b=>[b.name,b]));
  const times=animation.times.map(t=>t-animation.times[0]);
  for(const source of animation.bones){
    const target=targets.get(source.name),length=lengths.get(source.name);
    if(!target||length===undefined)throw Error(`Animation bone not in character: ${source.name}`);
    const rotations=source.rotations.slice();
    for(let i=0;i<rotations.length;i+=4){const q=new Quaternion().fromArray(rotations,i).normalize();q.toArray(rotations,i);}
    tracks.push(new QuaternionKeyframeTrack(`${target.uuid}.quaternion`,times,rotations));
    tracks.push(new VectorKeyframeTrack(`${target.uuid}.position`,times,source.directions.map(v=>v*length)));
  }
  if(animation.bones.length!==skeleton.bones.length)throw Error('Animation does not cover the character skeleton');
  return new AnimationClip(name,times[times.length-1],tracks);
}

export function createCharacterSkeleton(defs:SkeletonBone[]){
  const root=new Group();root.name='Skeleton';
  const bones=defs.map(def=>{
    const bone=new Bone(),r=def.rotation;bone.name=def.name;
    new Matrix4().set(r[0],r[3],r[6],def.position[0]*.01,r[1],r[4],r[7],def.position[1]*.01,r[2],r[5],r[8],def.position[2]*.01,0,0,0,1).decompose(bone.position,bone.quaternion,bone.scale);
    bone.userData.jointLimitsRadians=def.limits;return bone;
  });
  defs.forEach((def,i)=>{(def.parent<0?root:bones[def.parent]).add(bones[i]);});
  root.updateMatrixWorld(true);return {root,bones,skeleton:new Skeleton(bones)};
}

export function createSkinGeometry(source:ScxMesh,bones:number){
  if(!source.bonePalette||!source.boneWeights)throw Error('Character mesh has no skin binding');
  if(source.bonePalette.some(id=>id>=bones))throw Error('Character palette exceeds skeleton');
  const n=source.positions.length/3,indices=new Uint16Array(n*4),weights=source.boneWeights.slice();
  for(let v=0;v<n;v++){
    let sum=0;
    for(let k=0;k<4;k++){
      const w=weights[v*4+k];if(!Number.isFinite(w)||w< -1e-6)throw Error('Character skin has unsupported negative weights');
      weights[v*4+k]=Math.max(0,w);sum+=weights[v*4+k];
      if(w!==0){const local=source.boneIndices?.[v*4+k]??k;if(local>=source.bonePalette.length)throw Error('Character local palette index out of range');indices[v*4+k]=source.bonePalette[local];}
    }
    if(Math.abs(sum-1)>1e-5)throw Error('Character weights do not sum to one');
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(source.positions.map(x=>x*.01),3));
  geometry.setAttribute('normal',new BufferAttribute(source.normals.slice(),3));geometry.setAttribute('uv',new BufferAttribute(source.uv.slice(),2));
  geometry.setAttribute('skinIndex',new BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new BufferAttribute(weights,4));
  geometry.setIndex(new BufferAttribute(source.indices.slice(),1));if(!source.normals.some(n=>n!==0))geometry.computeVertexNormals();return geometry;
}

export class SkinnedCharacter {
  readonly root=new Group();readonly helper:SkeletonHelper;
  readonly rest:Quaternion[];readonly restPositions:Vector3[];readonly meshes:SkinnedMesh[]=[];
  private mixer:AnimationMixer;private lastTime?:number;private playing=false;
  private action?:AnimationAction;
  private ragdoll?:CharacterRagdoll;
  private ragdollRequest=0;
  private disposed=false;
  private ragdollFloor=0;
  private resumeState?:{positions:Vector3[];rotations:Quaternion[];scales:Vector3[];playing:boolean};
  bone=0;axis:'X'|'Y'|'Z'='Z';angle=0;
  constructor(readonly definitions:SkeletonBone[],readonly skeleton:Skeleton,readonly skeletonRoot:Group,readonly source:{pack:string;id:number;mesh:string;skeleton:string}){
    this.root.name='Vin';this.root.add(skeletonRoot);this.root.userData.source=source;this.rest=skeleton.bones.map(b=>b.quaternion.clone());
    this.restPositions=skeleton.bones.map(b=>b.position.clone());
    this.helper=new SkeletonHelper(this.root);for(const material of Array.isArray(this.helper.material)?this.helper.material:[this.helper.material]){material.depthTest=false;material.depthWrite=false;}this.helper.renderOrder=100;
    this.mixer=new AnimationMixer(this.root);
    this.bone=Math.max(0,skeleton.bones.findIndex(b=>b.name==='Bip01 L UpperArm'));
  }
  setPose(bone:number,axis:'X'|'Y'|'Z',degrees:number){
    if(!Number.isInteger(bone)||!this.skeleton.bones[bone]||!['X','Y','Z'].includes(axis)||!Number.isFinite(degrees))throw Error('Invalid bone pose');
    this.stopRagdoll();this.animate(false);this.bone=bone;this.axis=axis;this.angle=Math.max(-90,Math.min(90,degrees));
    this.skeleton.bones.forEach((b,i)=>{b.quaternion.copy(this.rest[i]);b.position.copy(this.restPositions[i]);});
    const direction=new Vector3(axis==='X'?1:0,axis==='Y'?1:0,axis==='Z'?1:0);
    this.skeleton.bones[bone].quaternion.multiply(new Quaternion().setFromAxisAngle(direction,this.angle*Math.PI/180));this.refresh();
  }
  refresh(bounds=true){this.root.updateWorldMatrix(true,false);this.root.updateMatrixWorld(true);this.skeleton.update();if(bounds)for(const mesh of this.meshes){mesh.computeBoundingBox();mesh.computeBoundingSphere();}}
  testClip(){
    const rest=this.rest[this.bone],direction=new Vector3(this.axis==='X'?1:0,this.axis==='Y'?1:0,this.axis==='Z'?1:0);
    const turned=rest.clone().multiply(new Quaternion().setFromAxisAngle(direction,(this.angle||45)*Math.PI/180));
    return new AnimationClip('Bone rotation test',2,[new QuaternionKeyframeTrack(`${this.skeleton.bones[this.bone].uuid}.quaternion`,[0,1,2],[...rest.toArray(),...turned.toArray(),...rest.toArray()])]);
  }
  animate(enabled:boolean){this.stopRagdoll();this.mixer.stopAllAction();this.action=undefined;this.playing=enabled;this.lastTime=undefined;if(enabled)this.action=this.mixer.clipAction(this.testClip()).reset().play();}
  setRagdollFloor(y:number){this.ragdollFloor=y;}
  get isRagdoll(){return !!this.ragdoll;}
  get ragdollPosition(){return this.ragdoll?.position;}
  setRagdollVehicles(cars:readonly RagdollCar[],dt:number){this.ragdoll?.setVehicles(cars,dt);}
  async startRagdoll(activation:RagdollActivation={}){
    if(this.ragdoll||this.disposed)return;
    const request=++this.ragdollRequest,{CharacterRagdoll}=await import('./character-ragdoll');
    if(request!==this.ragdollRequest||this.disposed||this.ragdoll)return;
    this.refresh();
    const skin:{position:Vector3;bone:number}[]=[];
    for(const mesh of this.meshes){const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
      for(let i=0;i<indices.count;i++){let strongest=0;for(let k=1;k<4;k++)if(weights.getComponent(i,k)>weights.getComponent(i,strongest))strongest=k;skin.push({position:mesh.getVertexPosition(i,new Vector3()),bone:indices.getComponent(i,strongest)});}}
    const ragdoll=new CharacterRagdoll(this.skeleton,this.root,this.ragdollFloor,skin,activation);
    this.resumeState={positions:this.skeleton.bones.map(b=>b.position.clone()),rotations:this.skeleton.bones.map(b=>b.quaternion.clone()),scales:this.skeleton.bones.map(b=>b.scale.clone()),playing:this.playing};
    this.ragdoll=ragdoll;this.setPlaybackPlaying(false);this.lastTime=undefined;
  }
  stopRagdoll(){
    ++this.ragdollRequest;
    if(!this.ragdoll)return;
    this.ragdoll.dispose();this.ragdoll=undefined;
    if(this.resumeState){const saved=this.resumeState;this.resumeState=undefined;this.skeleton.bones.forEach((b,i)=>{b.position.copy(saved.positions[i]);b.quaternion.copy(saved.rotations[i]);b.scale.copy(saved.scales[i]);});this.setPlaybackPlaying(saved.playing);}
    this.refresh();
  }
  playClip(clip:AnimationClip,playing=true,loop=true){
    this.setPose(this.bone,this.axis,0);this.action=this.mixer.clipAction(clip).reset();
    this.action.setLoop(loop?LoopRepeat:LoopOnce,loop?Infinity:1);this.action.clampWhenFinished=true;this.action.play();
    this.setPlaybackPlaying(playing);this.mixer.update(0);this.refresh();
  }
  setPlaybackPlaying(playing:boolean){this.playing=playing;this.lastTime=undefined;if(this.action)this.action.paused=!playing;}
  setPlaybackLoop(loop:boolean){this.action?.setLoop(loop?LoopRepeat:LoopOnce,loop?Infinity:1);}
  setPlaybackSpeed(speed:number){if(!Number.isFinite(speed))throw Error('Invalid animation speed');this.mixer.timeScale=speed;}
  fadeIn(seconds:number){if(seconds>0)this.action?.fadeIn(seconds);}
  get playbackTime(){return this.action?.time??0;}
  seek(time:number){if(!this.action||!Number.isFinite(time))return;this.action.time=Math.max(0,Math.min(time,this.action.getClip().duration));this.mixer.update(0);this.refresh();}
  async loadOriginalClip(assets:Assets,id:number,fitToModel=false,pack=this.source.pack){
    const resolved=await assets.resource(pack,id),path=entryProperties(resolved.entry).find(p=>p.key==='sourcefile')?.value;
    if(!path||!path.toLowerCase().endsWith('.matrixdata'))throw Error('RPK animation has no matrixdata source');
    const [bytes,referenceBytes]=await Promise.all([assets.read(path),assets.read(path.replace(/\.matrixdata$/i,'.bon'))]);
    const animation=parseMatrixData(bytes),reference=parseSkeleton(new TextDecoder().decode(referenceBytes));
    const incompatible=skeletonCompatibility(this.definitions,reference);if(incompatible)throw Error(incompatible);
    const clip=createOriginalClip(animation,this.skeleton,fitToModel?this.definitions:reference,resolved.entry.alias);
    return {path,animation,clip};
  }
  update(now:number,bounds=true){if(!this.playing&&!this.ragdoll)return;if(this.lastTime!==undefined){const dt=Math.max(0,Math.min(.1,(now-this.lastTime)/1000));if(this.ragdoll)this.ragdoll.step(dt);else this.mixer.update(dt);this.refresh(bounds);}this.lastTime=now;}
  deformation(){
    this.refresh();let moved=0,total=0,max=0;const point=new Vector3(),base=new Vector3();
    for(const mesh of this.meshes){const attribute=mesh.geometry.getAttribute('position');for(let i=0;i<attribute.count;i++){mesh.getVertexPosition(i,point);base.fromBufferAttribute(attribute,i);const distance=point.distanceTo(base);if(distance>1e-5)moved++;max=Math.max(max,distance);total++;}}
    return {moved,total,max};
  }
  dispose(){this.disposed=true;this.stopRagdoll();this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root);this.helper.removeFromParent();this.helper.dispose();this.skeleton.dispose();for(const mesh of this.meshes){mesh.geometry.dispose();const material=mesh.material as MeshStandardMaterial;material.map?.dispose();material.dispose();}this.root.removeFromParent();}
}

export async function loadSkinnedCharacter(assets:Assets,loadTexture:(bytes:Uint8Array,path:string)=>Promise<Texture>,pack='humans.rpk',id=0xc,skeletonOverride?:string){
  const resolved=await assets.resource(pack,id),properties=entryProperties(resolved.entry),skeletonPath=skeletonOverride??properties.find(p=>p.key==='skeleton')?.value;
  if(!skeletonPath)throw Error('RPK render has no skeleton descriptor');
  const model=await assets.modelForResource(pack,id),[parsed,bytes]=await Promise.all([parseScxAsync(await assets.read(model.path)),assets.read(skeletonPath)]);
  const definitions=parseSkeleton(new TextDecoder().decode(bytes)),rig=createCharacterSkeleton(definitions),character=new SkinnedCharacter(definitions,rig.skeleton,rig.root,{pack:resolved.packPath,id,mesh:model.path,skeleton:skeletonPath});
  character.root.name=resolved.entry.alias;
  try{
    for(const source of parsed.meshes){
      const geometry=createSkinGeometry(source,definitions.length),material=new MeshStandardMaterial({color:new Color().setRGB(...source.diffuse.slice(0,3) as [number,number,number]),roughness:.85,metalness:0,side:FrontSide});
      const mesh=new SkinnedMesh(geometry,material);mesh.name=`${resolved.entry.alias} section ${character.meshes.length}`;character.root.add(mesh);character.meshes.push(mesh);
      const texturePath=model.textures[source.textureIndex];if(texturePath){material.map=await loadTexture(await assets.read(texturePath),texturePath);material.map.colorSpace=SRGBColorSpace;material.color.set(0xffffff);if(source.textureMap){material.map.repeat.set(source.textureMap.scaleU,source.textureMap.scaleV);material.map.offset.set(source.textureMap.offsetU,source.textureMap.offsetV);}}
      character.root.updateMatrixWorld(true);mesh.bind(rig.skeleton,new Matrix4());mesh.castShadow=true;mesh.receiveShadow=true;
    }
    character.refresh();return character;
  }catch(error){character.dispose();throw error;}
}

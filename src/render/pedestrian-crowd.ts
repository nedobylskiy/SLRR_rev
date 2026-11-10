import {Box3,Group,Vector3,type Texture} from 'three';
import type {Assets} from '../assets';
import type {PedestrianWalk} from '../formats/pedestrian';
import {spawnWalkingPedestrians,type WalkingPedestrian} from '../engine/pedestrian-walking';
import {loadCharacterCatalog,skeletonCompatibility} from './character-catalog';
import {loadSkinnedCharacter,type SkinnedCharacter} from './skinned-character';

export class PedestrianCrowd {
  readonly root=new Group();private lastTime?:number;
  private actors:{walker:WalkingPedestrian;character:SkinnedCharacter;mount:Group}[]=[];
  get count(){return this.actors.length;}
  get inspectionPoint(){return this.actors[0]?.walker.position.clone();}
  static async create(assets:Assets,walk:PedestrianWalk[],focus:Vector3,texture:(bytes:Uint8Array,path:string)=>Promise<Texture>){
    const crowd=new PedestrianCrowd();crowd.root.name='Experimental walking pedestrians';
    try{
      const catalog=await loadCharacterCatalog(assets),models=catalog.models.filter(model=>model.path.replaceAll('\\','/').includes('/pedestrians/')&&catalog.animations.some(a=>a.family===model.family&&/_walk\.matrixdata$/i.test(a.path)&&!skeletonCompatibility(model.bones,a.bones)));
      if(!models.length)throw Error('No original pedestrian walking models/animations found');
      for(const [i,walker] of spawnWalkingPedestrians(walk,focus).entries()){
        const model=models[i%models.length],animation=catalog.animations.find(a=>a.family===model.family&&/_walk\.matrixdata$/i.test(a.path)&&!skeletonCompatibility(model.bones,a.bones))!;
        const character=await loadSkinnedCharacter(assets,texture,'humans.rpk',model.id);
        try{const {clip}=await character.loadOriginalClip(assets,animation.id);character.playClip(clip);character.seek(Math.random()*clip.duration);
          const bounds=new Box3().setFromObject(character.root);character.root.position.y=-bounds.min.y;
          for(const mesh of character.meshes){mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius+=.7;}
          const mount=new Group();mount.add(character.root);crowd.root.add(mount);mount.position.copy(walker.position);
          crowd.actors.push({walker,character,mount});
        }catch(error){character.dispose();throw error;}
      }return crowd;
    }catch(error){crowd.dispose();throw error;}
  }
  update(now:number,cars:readonly Vector3[]){
    const dt=this.lastTime===undefined?0:Math.max(0,Math.min(.1,(now-this.lastTime)/1000));this.lastTime=now;
    for(const {walker,character,mount} of this.actors){walker.step(dt,cars);mount.position.copy(walker.position);const yaw=Math.atan2(walker.direction.x,walker.direction.z),delta=Math.atan2(Math.sin(yaw-mount.rotation.y),Math.cos(yaw-mount.rotation.y));mount.rotation.y+=Math.max(-dt*5,Math.min(dt*5,delta));character.setPlaybackSpeed(walker.speed/1.2);character.update(now,false);}
  }
  dispose(){for(const actor of this.actors)actor.character.dispose();this.actors=[];this.root.removeFromParent();this.root.clear();}
}

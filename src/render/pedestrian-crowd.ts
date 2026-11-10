import {Box3,Group,Matrix4,Vector3,type Texture} from 'three';
import type {RigidBody3D} from '../engine/rigid-body-3d';
import {PEDESTRIAN_CAR_REACTION,pedestrianCarContact,ragdollCar} from '../engine/pedestrian-contact';
import type {Assets} from '../assets';
import type {PedestrianWalk} from '../formats/pedestrian';
import type {WalkingPedestrian} from '../engine/pedestrian-walking';
import {PedestrianSpawnIndex,type PedestrianObstacle} from '../engine/pedestrian-stream';
import {loadCharacterCatalog,skeletonCompatibility} from './character-catalog';
import {loadSkinnedCharacter,type SkinnedCharacter} from './skinned-character';

interface CrowdActor {walker:WalkingPedestrian;character:SkinnedCharacter;mount:Group;height:number;duration:number;active:boolean;revision:number;state:'walking'|'starting'|'ragdoll'|'failed'}
export interface PedestrianStreamSettings {count:number;radius:number}
export class PedestrianCrowd {
  readonly root=new Group();private lastTime?:number;
  private disposed=false;private previousCars=new WeakMap<RigidBody3D,Matrix4>();
  private actors:CrowdActor[]=[];
  private ground?:(point:Vector3)=>number;
  private index!:PedestrianSpawnIndex;
  private loadActor!:(walker:WalkingPedestrian)=>Promise<CrowdActor>;
  private spawning=false;private refillAt=0;private pruneAt=0;private focus=new Vector3();
  private focusSource?:Vector3;
  private settings:PedestrianStreamSettings={count:6,radius:100};
  lastError='';
  get ragdollCount(){return this.actors.filter(a=>a.active&&a.state==='ragdoll').length;}
  get count(){return this.actors.filter(a=>a.active).length;}
  get cachedCount(){return this.actors.length;}
  get inspectionPoint(){const actor=this.actors.find(a=>a.active);return actor?.character.ragdollPosition??actor?.walker.position.clone();}
  configure(count:number,radius:number){
    if(!Number.isInteger(count)||count<0||count>50)throw Error('Pedestrian count must be 0–50');
    if(!Number.isFinite(radius)||radius<50||radius>300)throw Error('Pedestrian spawn radius must be 50–300 m');
    this.settings={count,radius};this.pruneAt=0;this.refillAt=0;
  }
  private retire(actor:CrowdActor){actor.revision++;actor.active=false;actor.character.stopRagdoll();actor.mount.visible=false;}
  private async refill(occupied:PedestrianObstacle[],offscreen?:(point:Vector3)=>boolean){
    if(this.spawning||this.disposed||this.count>=this.settings.count)return;
    const spawn=this.index.choose(this.focus,this.settings.radius,occupied,offscreen);if(!spawn)return;
    this.spawning=true;
    try{
      const walker=this.index.walker(spawn);let actor=this.actors.find(a=>!a.active);
      if(!actor){actor=await this.loadActor(walker);if(this.disposed){actor.character.dispose();return;}this.actors.push(actor);this.root.add(actor.mount);}
      if(this.focusSource)this.focus.copy(this.focusSource);
      const distance=spawn.position.distanceTo(this.focus),hidden=offscreen?.(spawn.position)??false;
      if(this.count>=this.settings.count||distance>this.settings.radius+10||distance<(hidden?12:35)){actor.mount.visible=false;return;}
      actor.walker=walker;actor.state='walking';actor.active=true;actor.mount.visible=true;actor.mount.position.copy(walker.position);
      actor.mount.rotation.set(0,Math.atan2(walker.direction.x,walker.direction.z),0);actor.character.setPlaybackPlaying(true);actor.character.seek(Math.random()*actor.duration);
    }finally{this.spawning=false;}
  }
  static async create(assets:Assets,walk:PedestrianWalk[],focus:Vector3,texture:(bytes:Uint8Array,path:string)=>Promise<Texture>,ground?:(point:Vector3)=>number,settings:PedestrianStreamSettings={count:6,radius:100},offscreen?:(point:Vector3)=>boolean){
    const crowd=new PedestrianCrowd();crowd.ground=ground;crowd.root.name='Streamed walking pedestrians';crowd.configure(settings.count,settings.radius);crowd.focus.copy(focus);crowd.focusSource=focus;
    try{
      await import('./character-ragdoll');
      crowd.index=new PedestrianSpawnIndex(walk);
      const catalog=await loadCharacterCatalog(assets),models=catalog.models.filter(model=>model.path.replaceAll('\\','/').includes('/pedestrians/')&&catalog.animations.some(a=>a.family===model.family&&/_walk\.matrixdata$/i.test(a.path)&&!skeletonCompatibility(model.bones,a.bones)));
      if(!models.length)throw Error('No original pedestrian walking models/animations found');
      let nextModel=0;
      crowd.loadActor=async walker=>{
        const model=models[nextModel++%models.length],animation=catalog.animations.find(a=>a.family===model.family&&/_walk\.matrixdata$/i.test(a.path)&&!skeletonCompatibility(model.bones,a.bones))!;
        const character=await loadSkinnedCharacter(assets,texture,'humans.rpk',model.id);
        try{const {clip}=await character.loadOriginalClip(assets,animation.id);character.playClip(clip);character.seek(Math.random()*clip.duration);
          const bounds=new Box3().setFromObject(character.root);character.root.position.y=-bounds.min.y;
          for(const mesh of character.meshes){mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius+=.7;}
          const mount=new Group();mount.add(character.root);mount.position.copy(walker.position);
          return {walker,character,mount,height:bounds.getSize(new Vector3()).y,duration:clip.duration,state:'walking',active:false,revision:0};
        }catch(error){character.dispose();throw error;}
      };
      for(let i=0;i<Math.min(6,settings.count);i++)await crowd.refill(crowd.obstacles([]),offscreen);
      crowd.focusSource=undefined;return crowd;
    }catch(error){crowd.dispose();throw error;}
  }
  private obstacles(cars:readonly RigidBody3D[]):PedestrianObstacle[]{return [
    ...this.actors.filter(a=>a.active).map(a=>({position:a.character.ragdollPosition??a.walker.position,radius:2})),
    ...cars.map(car=>({position:car.position,radius:car.bounds.getSize(new Vector3()).length()*.5+1,velocity:car.velocity})),
  ];}

  update(now:number,cars:readonly RigidBody3D[],focus?:Vector3,offscreen?:(point:Vector3)=>boolean){
    if(this.disposed)return;if(focus)this.focus.copy(focus);
    if(now>=this.pruneAt){
      const active=this.actors.filter(a=>a.active).sort((a,b)=>(b.character.ragdollPosition??b.walker.position).distanceToSquared(this.focus)-(a.character.ragdollPosition??a.walker.position).distanceToSquared(this.focus));
      let remaining=active.length;
      for(const actor of active){const point=actor.character.ragdollPosition??actor.walker.position;
        if(remaining>this.settings.count||point.distanceTo(this.focus)>this.settings.radius+50){this.retire(actor);remaining--;}
      }this.pruneAt=now+500;
    }
    if(now>=this.refillAt){this.refillAt=now+250;void this.refill(this.obstacles(cars),offscreen).catch(error=>{this.lastError=String(error);console.error('Pedestrian stream load failed',error);});}
    const dt=this.lastTime===undefined?0:Math.max(0,Math.min(.1,(now-this.lastTime)/1000));this.lastTime=now;
    const positions=cars.map(car=>car.position),colliders=this.actors.some(a=>a.active&&a.state==='ragdoll')?cars.map(ragdollCar):[];
    for(const actor of this.actors){if(!actor.active)continue;const {walker,character,mount}=actor;
      if(actor.state==='ragdoll'){character.setRagdollVehicles(colliders,dt);character.update(now,true);continue;}
      if(actor.state!=='walking')continue;
      walker.step(dt,positions);mount.position.copy(walker.position);
      const yaw=Math.atan2(walker.direction.x,walker.direction.z),delta=Math.atan2(Math.sin(yaw-mount.rotation.y),Math.cos(yaw-mount.rotation.y));mount.rotation.y+=Math.max(-dt*5,Math.min(dt*5,delta));
      character.setPlaybackSpeed(walker.speed/1.2);character.update(now,false);
      const velocity=walker.direction.clone().multiplyScalar(walker.speed);
      for(const car of cars){
        const range=car.bounds.getSize(new Vector3()).length()*.5+actor.height+car.velocity.length()*dt+2;
        if(car.position.distanceToSquared(walker.position)>range*range)continue;
        const matrix=car.matrix(),previous=this.previousCars.get(car)??matrix.clone().setPosition(new Vector3().setFromMatrixPosition(matrix).addScaledVector(car.velocity,-dt));
        // A teleported/reset car must not sweep through everything between its old and new spawn.
        if(new Vector3().setFromMatrixPosition(previous).distanceTo(new Vector3().setFromMatrixPosition(matrix))>car.velocity.length()*dt*2+2)previous.copy(matrix);
        const hit=pedestrianCarContact(walker.position,actor.height,.25,velocity,car,previous);if(!hit)continue;
        const revision=++actor.revision;actor.state='starting';character.setPlaybackPlaying(false);mount.updateWorldMatrix(true,true);character.setRagdollFloor(-character.root.position.y);
        void character.startRagdoll({velocity,impulse:hit.impulse,point:hit.point,ground:this.ground}).then(()=>{
          if(this.disposed||!actor.active||actor.revision!==revision)return;
          if(character.isRagdoll){actor.state='ragdoll';car.impulse(hit.impulse.clone().multiplyScalar(-PEDESTRIAN_CAR_REACTION),hit.point);}
        }).catch(error=>{if(!this.disposed){actor.state='failed';console.error('Pedestrian ragdoll activation failed',error);}});
        break;
      }
    }
    for(const car of cars)this.previousCars.set(car,car.matrix());
  }
  dispose(){this.disposed=true;for(const actor of this.actors)actor.character.dispose();this.actors=[];this.root.removeFromParent();this.root.clear();}
}

import {Box3,Bone,Group,Matrix4,Mesh,MeshBasicMaterial,Quaternion,SphereGeometry,Vector3,type Texture} from 'three';
import type {Assets} from '../assets';
import {poseMatrix,type EnginePart} from '../engine/world';
import {parseScxAsync} from '../formats/scx-worker-client';
import {loadSkinnedCharacter,type SkinnedCharacter} from './skinned-character';

/** Rotate the current bone in world space; preserve translations and rest-axis twist. */
function aim(bone:Bone,child:Bone,target:Vector3,maxAngle=Math.PI){
  bone.updateWorldMatrix(true,true);const origin=bone.getWorldPosition(new Vector3()),from=child.getWorldPosition(new Vector3()).sub(origin),to=target.clone().sub(origin);if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return;
  const correction=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize()),angle=correction.angleTo(new Quaternion());if(angle>maxAngle)correction.identity().slerp(new Quaternion().setFromUnitVectors(from,to),maxAngle/angle);
  const world=correction.multiply(bone.getWorldQuaternion(new Quaternion())),parent=bone.parent!.getWorldQuaternion(new Quaternion());bone.quaternion.copy(parent.invert().multiply(world));bone.updateWorldMatrix(false,true);
}
/** Analytic two-link chain: bends toward a stable pole, never stretches bones. */
export function solveDriverLimb(upper:Bone,lower:Bone,end:Bone,target:Vector3,pole:Vector3){
  upper.updateWorldMatrix(true,true);const a=upper.getWorldPosition(new Vector3()),b=lower.getWorldPosition(new Vector3()),c=end.getWorldPosition(new Vector3()),l1=a.distanceTo(b),l2=b.distanceTo(c);
  const direction=target.clone().sub(a),distance=Math.max(Math.abs(l1-l2)+1e-5,Math.min(l1+l2-1e-5,direction.length()));if(direction.lengthSq()<1e-10)return;direction.normalize();
  const bend=pole.clone().addScaledVector(direction,-pole.dot(direction));if(bend.lengthSq()<1e-8)bend.set(1,0,0).addScaledVector(direction,-direction.x);bend.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along)),elbow=a.clone().addScaledVector(direction,along).addScaledVector(bend,height);
  aim(upper,lower,elbow);aim(lower,end,a.clone().addScaledVector(direction,distance));
}
/** Bounded positional CCD for the seated torso/neck; never translate or scale bones. */
export function fitDriverHead(chain:readonly Bone[],head:Bone,target:Vector3,neutral:readonly Quaternion[],limits:readonly number[]){
  for(let pass=0;pass<32;pass++){
    for(let i=chain.length-1;i>=0;i--){
      const bone=chain[i],before=bone.quaternion.clone(),error=head.getWorldPosition(new Vector3()).distanceToSquared(target);
      aim(bone,head,target,.25);
      const delta=neutral[i].clone().invert().multiply(bone.quaternion),angle=delta.angleTo(new Quaternion());
      if(angle>limits[i])bone.quaternion.copy(neutral[i]).multiply(new Quaternion().slerp(delta,limits[i]/angle));
      bone.updateWorldMatrix(false,true);
      if(head.getWorldPosition(new Vector3()).distanceToSquared(target)>error){bone.quaternion.copy(before);bone.updateWorldMatrix(false,true);}
    }
    if(head.getWorldPosition(new Vector3()).distanceToSquared(target)<1e-6)break;
  }
}
/** One rotational degree of freedom at a fixed grip: no sliding or wrist translation. */
export function wristPivot(grip:Quaternion,preferred:Quaternion,axis:Vector3,limit:number){
  const hinge=axis.clone().normalize(),from=new Vector3(1,0,0).applyQuaternion(grip),to=new Vector3(1,0,0).applyQuaternion(preferred);
  from.addScaledVector(hinge,-from.dot(hinge));to.addScaledVector(hinge,-to.dot(hinge));
  if(from.lengthSq()<1e-8||to.lengthSq()<1e-8)return grip.clone();from.normalize();to.normalize();
  const angle=Math.atan2(hinge.dot(from.clone().cross(to)),from.dot(to)),clamped=Math.max(-limit,Math.min(limit,angle));
  return new Quaternion().setFromAxisAngle(hinge,clamped).multiply(grip);
}
export class DriverIk {
  readonly root=new Group();readonly debug=new Group();
  readonly leftTarget=new Vector3();readonly rightTarget=new Vector3();
  private markers:Mesh[]=[];private wheelBase:Matrix4;
  private bones=new Map<string,Bone>();private errors=[0,0];
  private seat:Matrix4;private wheelRender:Matrix4;
  private disposed=false;
  private originalCharacterParent:Group|null;private originalCharacterMatrix:Matrix4;private originalCharacterAuto:boolean;
  // Vin has a closed fist: the wrist joint is about 8 cm behind its grip centre.
  // Calibrated in hand-local metres from the hand-weighted mesh, not a bone translation.
  private gripOffsets=[new Vector3(.0783,-.0044,-.0174),new Vector3(.0779,.0044,-.0174)];
  gripPosition(side:'L'|'R'){const index=side==='L'?0:1;return this.bones.get(`Bip01 ${side} Hand`)!.localToWorld(this.gripOffsets[index].clone());}
  private grips:(Quaternion|undefined)[]=[];private wristFree=true;
  private headError=0;private headFit=true;private seatedPose?:Map<Bone,Quaternion>;
  setHeadFit(enabled:boolean){this.headFit=enabled;}
  setWristPivot(enabled:boolean){this.wristFree=enabled;}
  constructor(readonly chassis:EnginePart,readonly wheel:EnginePart,readonly character:SkinnedCharacter,private center:Vector3,readonly radius:number,private ownsCharacter=true){
    if(!chassis.definition.config.seat)throw Error('Chassis has no CFG seat');
    this.originalCharacterParent=character.root.parent as Group|null;this.originalCharacterMatrix=character.root.matrix.clone();this.originalCharacterAuto=character.root.matrixAutoUpdate;
    this.wheelBase=wheel.local.clone();this.seat=poseMatrix(chassis.definition.config.seat);this.wheelRender=wheel.definition.config.renderPose?poseMatrix(wheel.definition.config.renderPose):new Matrix4();
    this.root.name='Seated driver IK';this.root.matrixAutoUpdate=false;this.root.add(character.root,this.debug);character.root.matrixAutoUpdate=false;character.root.matrix.copy(this.seat);character.helper.visible=false;
    for(const b of character.skeleton.bones)this.bones.set(b.name,b);
    for(const name of ['Bip01 Spine','Bip01 Head','Bip01 L UpperArm','Bip01 L Forearm','Bip01 L Hand','Bip01 R UpperArm','Bip01 R Forearm','Bip01 R Hand'])if(!this.bones.has(name))throw Error(`Driver bone missing: ${name}`);
    for(const color of [0x54ffc0,0xffb552,0x7ab9ff]){const marker=new Mesh(new SphereGeometry(.015,10,8),new MeshBasicMaterial({color,depthTest:false}));marker.renderOrder=100;this.debug.add(marker);this.markers.push(marker);}
    const saved=wheel.local.clone();this.setSteeringAngle(0);this.update();wheel.local.copy(saved);

  }
  static async create(chassis:EnginePart,assets:Assets,texture:(bytes:Uint8Array,path:string)=>Promise<Texture>,existingCharacter?:SkinnedCharacter,isCurrent:()=>boolean=()=>true){
    const slot=chassis.definition.config.slots.find(s=>s.type===11),wheel=slot&&chassis.children.get(slot.id);if(!wheel?.definition.model)throw Error('Install a steering wheel before enabling driver IK');
    const parsed=await parseScxAsync(await assets.read(wheel.definition.model.path)),bounds=new Box3();for(const mesh of parsed.meshes)for(let i=0;i<mesh.positions.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(mesh.positions,i).multiplyScalar(.01));
    const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3()),radius=Math.max(size.x,size.y)*.5;
    if(!Number.isFinite(radius)||radius<.05||radius>.5)throw Error('Invalid steering wheel geometry');
    if(!isCurrent())throw Error('Driver binding superseded');
    const character=existingCharacter??await loadSkinnedCharacter(assets,texture,'humans.rpk',0xc);
    try{return new DriverIk(chassis,wheel,character,center,radius,!existingCharacter);}catch(error){if(!existingCharacter)character.dispose();throw error;}
  }
  setSteeringAngle(angle:number){
    const slot=this.chassis.definition.config.slots.find(s=>s.type===11),own=this.wheel.definition.config.slots.find(s=>s.id===this.wheel.ownSlot);
    if(!slot||!own||!Number.isFinite(angle))return;
    this.wheel.local.copy(this.chassis.slotFrame(slot)).multiply(new Matrix4().makeRotationZ(angle)).multiply(this.wheel.slotFrame(own).invert());
  }
  update(){
    if(this.disposed||this.chassis.world.disposed)return;
    this.root.matrix.copy(this.chassis.matrix());this.root.updateWorldMatrix(true,true);
    if(this.wheel.parent!==this.chassis){this.debug.visible=false;return;}
    this.character.skeleton.bones.forEach((b,i)=>{b.quaternion.copy(this.character.rest[i]);b.position.copy(this.character.restPositions[i]);});this.root.updateWorldMatrix(true,true);
    const cfg=this.chassis.definition.config,spine=this.bones.get('Bip01 Spine')!,head=this.bones.get('Bip01 Head')!,camera=cfg.cameras[0];
    // Seat fixes the hips; the authored cockpit point supplies a neutral torso posture.
    if(camera&&(!this.headFit||!this.seatedPose))aim(spine,head,new Vector3(...camera.position).applyMatrix4(this.root.matrixWorld),.45);
    if(camera&&this.headFit){
      if(this.seatedPose){for(const [bone,rotation] of this.seatedPose)bone.quaternion.copy(rotation);this.root.updateWorldMatrix(false,true);}
      else {
        const chain=['Bip01 Spine','Bip01 Spine1','Bip01 Neck'].map(name=>this.bones.get(name)).filter((bone):bone is Bone=>!!bone);
        const neutral=chain.map(bone=>this.character.rest[this.character.skeleton.bones.indexOf(bone)]);
        const target=new Vector3(...camera.position).applyMatrix4(this.root.matrixWorld);
        // Treat the cockpit point as the head-joint goal, not a detected roof plane.
        // These swing limits are host approximations; native per-axis limits differ.
        const neck=this.bones.get('Bip01 Neck');
        const localRest=this.character.rest[this.character.skeleton.bones.indexOf(head)].clone();
        let orientation=localRest.clone();let ancestor=head.parent as Bone;
        while(ancestor?.isBone){orientation.premultiply(this.character.rest[this.character.skeleton.bones.indexOf(ancestor)]);ancestor=ancestor.parent as Bone;}
        // Vin's head-local X is up. Level bind gaze before applying cockpit YPR.
        orientation.premultiply(new Quaternion().setFromUnitVectors(new Vector3(1,0,0).applyQuaternion(orientation).normalize(),new Vector3(0,1,0)));
        const restWorld=this.root.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().setFromRotationMatrix(poseMatrix(camera))).multiply(orientation);
        if(neck){
          const neckRotation=restWorld.clone().multiply(localRest.clone().invert());
          const offset=head.position.clone().multiply(head.getWorldScale(new Vector3())).applyQuaternion(neckRotation);
          const torso=chain.filter(bone=>bone!==neck),torsoNeutral=torso.map(bone=>neutral[chain.indexOf(bone)]);
          const neckTarget=target.clone().sub(offset),limits=torso.map(()=>1.8);
          // Seed the bend explicitly: a perfectly straight spine is a CCD
          // singularity and cannot shorten by rotating toward its own axis.
          // Bias the middle of the back toward the seat (+Z), rather than
          // folding the chest forward/up into the chin.
          if(torso.length===2)solveDriverLimb(torso[0],torso[1],neck,neckTarget,new Vector3(0,0,1).transformDirection(this.root.matrixWorld));
          torso.forEach((bone,i)=>{const delta=torsoNeutral[i].clone().invert().multiply(bone.quaternion),angle=delta.angleTo(new Quaternion());if(angle>limits[i])bone.quaternion.copy(torsoNeutral[i]).multiply(new Quaternion().slerp(delta,limits[i]/angle));});
          this.root.updateWorldMatrix(false,true);fitDriverHead(torso,neck,neckTarget,torsoNeutral,limits);
          neck.quaternion.copy(neck.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(neckRotation));neck.updateWorldMatrix(false,true);
          head.quaternion.copy(head.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(restWorld));head.updateWorldMatrix(false,true);
        }else fitDriverHead(chain,head,target,neutral,chain.map(()=>1.1));
        this.seatedPose=new Map([...chain,head].map(bone=>[bone,bone.quaternion.clone()]));
      }
    }
    this.markers[2].visible=!!camera;
    if(camera){this.markers[2].position.set(...camera.position);this.headError=head.getWorldPosition(new Vector3()).distanceTo(new Vector3(...camera.position).applyMatrix4(this.root.matrixWorld))/this.root.getWorldScale(new Vector3()).x;}
    const wheelFrame=this.chassis.matrix().invert().multiply(this.wheel.matrix()).multiply(this.wheelRender),gripRadius=Math.max(.04,this.radius-.015);
    for(const [index,side] of ['L','R'].entries()){
      const sign=side==='L'?-1:1,angle=sign*1;
      const target=new Vector3(Math.sin(angle)*gripRadius,Math.cos(angle)*gripRadius,this.center.z).add(new Vector3(this.center.x,this.center.y,0)).applyMatrix4(wheelFrame);
      this.markers[index].position.copy(target);target.applyMatrix4(this.root.matrixWorld);(index?this.rightTarget:this.leftTarget).copy(target);
      const upper=this.bones.get(`Bip01 ${side} UpperArm`)!,lower=this.bones.get(`Bip01 ${side} Forearm`)!,hand=this.bones.get(`Bip01 ${side} Hand`)!;
      const clavicle=this.bones.get(`Bip01 ${side} Clavicle`);
      const pole=new Vector3(sign*.5,-1,0).transformDirection(this.root.matrixWorld);
      const wheelWorld=this.root.matrixWorld.clone().multiply(wheelFrame),wheelRotation=new Quaternion().setFromRotationMatrix(wheelWorld.clone().extractRotation(wheelWorld));
      if(!this.grips[index]){
        if(clavicle)aim(clavicle,upper,target,.8);
        solveDriverLimb(upper,lower,hand,target,pole);
        this.grips[index]=wheelRotation.clone().invert().multiply(hand.getWorldQuaternion(new Quaternion()));
      }
      const grip=wheelRotation.clone().multiply(this.grips[index]!);
      const handScale=hand.getWorldScale(new Vector3());
      const wristTarget=(orientation:Quaternion)=>target.clone().sub(this.gripOffsets[index].clone().multiply(handScale).applyQuaternion(orientation));
      // First solve with the fixed grip. Choose wrist freedom from that stable
      // arm pose, never from the result of its own previous correction.
      const fixedTarget=wristTarget(grip);
      if(clavicle)aim(clavicle,upper,fixedTarget,.8);
      solveDriverLimb(upper,lower,hand,fixedTarget,pole);
      const preferred=hand.getWorldQuaternion(new Quaternion());
      // Twist around the line through wrist and palm contact. Both points lie
      // on this axis, so wrist freedom cannot move the grip or alter upstream IK.
      // A rim-tangent hinge instead moves the wrist, requiring shoulder rotation.
      const hinge=this.gripOffsets[index].clone().multiply(handScale).applyQuaternion(grip).normalize();
      const orientation=this.wristFree?wristPivot(grip,preferred,hinge,Math.PI*35/180):grip;
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(orientation));hand.updateWorldMatrix(false,true);
      this.errors[index]=this.gripPosition(side as 'L'|'R').distanceTo(target);
      const thigh=this.bones.get(`Bip01 ${side} Thigh`),calf=this.bones.get(`Bip01 ${side} Calf`),foot=this.bones.get(`Bip01 ${side} Foot`);
      if(cfg.pedals&&thigh&&calf&&foot){const pedal=new Vector3(...cfg.pedals).add(new Vector3(sign*.1,0,0)).applyMatrix4(this.root.matrixWorld);solveDriverLimb(thigh,calf,foot,pedal,new Vector3(0,.5,-1).transformDirection(this.root.matrixWorld));}
    }
    this.character.refresh(false);
  }
  info(){const scale=this.root.getWorldScale(new Vector3()).x;return `Vin · seat + head + two hand IK · head error ${(this.headError*100).toFixed(1)} cm · wheel radius ${(this.radius*100).toFixed(1)} cm · grip error L/R ${(this.errors[0]/scale*100).toFixed(1)} / ${(this.errors[1]/scale*100).toFixed(1)} cm`;}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    if(this.ownsCharacter){this.wheel.local.copy(this.wheelBase);this.character.dispose();}
    else {
      this.character.root.removeFromParent();this.originalCharacterParent?.add(this.character.root);
      this.character.root.matrix.copy(this.originalCharacterMatrix);this.character.root.matrixAutoUpdate=this.originalCharacterAuto;
      this.character.skeleton.bones.forEach((bone,i)=>{bone.quaternion.copy(this.character.rest[i]);bone.position.copy(this.character.restPositions[i]);});this.character.refresh(false);
    }
    this.root.removeFromParent();for(const marker of this.markers){marker.geometry.dispose();(marker.material as MeshBasicMaterial).dispose();}
  }
}

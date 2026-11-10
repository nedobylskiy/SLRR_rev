import {Body,ConeTwistConstraint,Cylinder,GSSolver,Plane,Quaternion as PhysicsQuaternion,Sphere,Vec3,World} from 'cannon-es';
import {Matrix4,Quaternion,Vector3,type Group,type Skeleton} from 'three';

interface Pose {position:Vector3;rotation:Quaternion}
interface Limb {index:number;body:Body;offset:Vector3;pose:Pose;length:number;direction:Vector3;radius:number}
export interface RagdollSkinPoint {position:Vector3;bone:number}
const vector=(v:Vector3)=>new Vec3(v.x,v.y,v.z);
const rotation=(q:Quaternion)=>new PhysicsQuaternion(q.x,q.y,q.z,q.w);
const Y=new Vector3(0,1,0);

/** Playground-only, metre-space rigid ragdoll. Local bone limits are deliberately
 * not reused until their native joint frames have been reconstructed. */
export class CharacterRagdoll {
  readonly world=new World({gravity:new Vec3(0,-9.81,0),allowSleep:true});
  readonly limbs:Limb[]=[];
  private poses:Pose[];
  private owners:Limb[];
  private order:number[];
  constructor(private skeleton:Skeleton,private root:Group,readonly floorY:number,skin:RagdollSkinPoint[]=[]){
    root.updateWorldMatrix(true,true);
    const inverse=root.matrixWorld.clone().invert(),scale=new Vector3();
    this.poses=skeleton.bones.map(bone=>{const position=new Vector3(),rotation=new Quaternion();new Matrix4().multiplyMatrices(inverse,bone.matrixWorld).decompose(position,rotation,scale);return {position,rotation};});
    const names=new Map(skeleton.bones.map((bone,i)=>[bone.name,i]));
    const find=(suffix:string)=>names.get(`Bip01 ${suffix}`);
    const pelvis=find('Pelvis'),chest=find('Spine2')??find('Spine1')??find('Spine');
    if(pelvis===undefined||chest===undefined)throw Error('Ragdoll needs a Biped pelvis and spine');
    const solver=new GSSolver();solver.iterations=25;solver.tolerance=1e-7;this.world.solver=solver;
    this.world.defaultContactMaterial.friction=.65;this.world.defaultContactMaterial.restitution=0;
    this.world.defaultContactMaterial.contactEquationStiffness=1e7;
    this.world.defaultContactMaterial.contactEquationRelaxation=4;
    const floor=new Body({mass:0,shape:new Plane(),collisionFilterGroup:2,collisionFilterMask:1});floor.position.y=floorY;floor.quaternion.setFromEuler(-Math.PI/2,0,0);this.world.addBody(floor);
    const height=Math.max(...this.poses.map(p=>p.position.y))-Math.min(...this.poses.map(p=>p.position.y))+.2;
    const radiusScale=Math.max(.7,Math.min(1.5,height/1.8));
    const add=(index:number|undefined,end:number|undefined,mass:number,radius:number,extension=.12)=>{
      if(index===undefined)return;
      const pose=this.poses[index],start=pose.position;
      const finish=end===undefined?start.clone().add(new Vector3(extension,0,0).applyQuaternion(pose.rotation)):this.poses[end].position;
      const direction=finish.clone().sub(start),length=Math.max(direction.length(),.03);direction.normalize();
      if(direction.lengthSq()<.5)direction.copy(Y);
      const center=start.clone().add(finish).multiplyScalar(.5),r=radius*radiusScale;
      const body=new Body({mass,position:vector(center),linearDamping:.12,angularDamping:.3,allowSleep:true,sleepSpeedLimit:.08,sleepTimeLimit:1,collisionFilterGroup:1,collisionFilterMask:3});
      const axisRotation=new Quaternion().setFromUnitVectors(Y,direction);
      body.addShape(new Cylinder(r,r,length,8),new Vec3(),rotation(axisRotation));
      body.addShape(new Sphere(r),vector(direction.clone().multiplyScalar(length/2)));
      body.addShape(new Sphere(r),vector(direction.clone().multiplyScalar(-length/2)));
      this.world.addBody(body);this.limbs.push({index,body,offset:center.clone().sub(start),pose,length,direction,radius:r});
    };
    add(pelvis,chest,12,.11);add(chest,find('Neck')??find('Head'),20,.13);add(find('Head'),undefined,5,.095,.16);
    for(const side of ['L','R']){
      add(find(`${side} UpperArm`),find(`${side} Forearm`),2,.045);
      add(find(`${side} Forearm`),find(`${side} Hand`),1.5,.035);
      add(find(`${side} Hand`),find(`${side} Finger0`),.7,.035,.09);
      add(find(`${side} Thigh`),find(`${side} Calf`),7,.075);
      add(find(`${side} Calf`),find(`${side} Foot`),3.5,.055);
      add(find(`${side} Foot`),find(`${side} Toe0`),1.2,.045,.14);
    }
    const boneIndex=new Map(skeleton.bones.map((bone,i)=>[bone,i])),byIndex=new Map(this.limbs.map(limb=>[limb.index,limb]));
    const parent=(index:number)=>boneIndex.get(skeleton.bones[index].parent as typeof skeleton.bones[number]);
    const owner=(index:number,includeSelf=true):Limb|undefined=>{
      let current=includeSelf?index:parent(index);
      while(current!==undefined){const limb=byIndex.get(current);if(limb)return limb;current=parent(current);}
    };
    for(const limb of this.limbs){
      const ancestor=owner(limb.index,false);if(!ancestor)continue;
      const joint=limb.pose.position,name=skeleton.bones[limb.index].name;
      const tight=/Calf|Forearm/.test(name),torso=limb.index===chest;
      const axis=limb.offset.clone().normalize();if(axis.lengthSq()<.5)axis.copy(Y);
      const constraint=new ConeTwistConstraint(ancestor.body,limb.body,{
        pivotA:vector(joint.clone().sub(new Vector3(ancestor.body.position.x,ancestor.body.position.y,ancestor.body.position.z))),
        pivotB:vector(limb.offset.clone().negate()),axisA:vector(axis),axisB:vector(axis),
        angle:tight?.85:torso?.3:/Head|Foot/.test(name)?.5:1.2,twistAngle:tight?.12:torso?.2:.6,maxForce:1e5,collideConnected:false,
      });
      this.world.addConstraint(constraint);
    }
    const anchor=byIndex.get(pelvis)!;this.owners=skeleton.bones.map((_,i)=>owner(i)??anchor);
    // Fit the capsule envelope once, including shoes/clothing extending past a joint.
    for(const point of skin){
      const limb=this.owners[point.bone];if(!limb)continue;
      const fromStart=point.position.clone().sub(limb.pose.position),along=Math.max(0,Math.min(limb.length,fromStart.dot(limb.direction)));
      const distance=fromStart.addScaledVector(limb.direction,-along).length()+.005;
      limb.radius=Math.max(limb.radius,Math.min(distance,.25*radiusScale));
    }
    for(const limb of this.limbs){
      for(const shape of [...limb.body.shapes])limb.body.removeShape(shape);
      limb.body.addShape(new Cylinder(limb.radius,limb.radius,limb.length,8),new Vec3(),rotation(new Quaternion().setFromUnitVectors(Y,limb.direction)));
      for(const sign of [-1,1])limb.body.addShape(new Sphere(limb.radius),vector(limb.direction.clone().multiplyScalar(sign*limb.length/2)));
    }
    const depth=(i:number):number=>{const p=parent(i);return p===undefined?0:depth(p)+1;};
    this.order=skeleton.bones.map((_,i)=>i).sort((a,b)=>depth(a)-depth(b));
    // A tiny torso perturbation lets an exactly balanced paused pose topple too.
    byIndex.get(chest)!.body.velocity.z=.15;
  }
  step(seconds:number){if(!Number.isFinite(seconds)||seconds<=0)return;this.world.step(1/120,Math.min(seconds,.1),12);this.applyPose();}
  applyPose(){
    const desired=this.poses.map((pose,i)=>{
      const limb=this.owners[i],q=new Quaternion(limb.body.quaternion.x,limb.body.quaternion.y,limb.body.quaternion.z,limb.body.quaternion.w);
      const base=new Vector3(limb.body.position.x,limb.body.position.y,limb.body.position.z).sub(limb.offset.clone().applyQuaternion(q));
      return {position:pose.position.clone().sub(limb.pose.position).applyQuaternion(q).add(base),rotation:q.multiply(pose.rotation)};
    });
    const rootInverse=this.root.matrixWorld.clone().invert(),scale=new Vector3(1,1,1);
    for(const i of this.order){
      const bone=this.skeleton.bones[i],pose=desired[i];
      const parent=bone.parent!;parent.updateWorldMatrix(true,false);
      const parentInverse=new Matrix4().multiplyMatrices(rootInverse,parent.matrixWorld).invert();
      new Matrix4().multiplyMatrices(parentInverse,new Matrix4().compose(pose.position,pose.rotation,scale)).decompose(bone.position,bone.quaternion,bone.scale);
      bone.updateMatrixWorld(true);
    }
  }
  dispose(){for(const constraint of [...this.world.constraints])this.world.removeConstraint(constraint);for(const body of [...this.world.bodies])this.world.removeBody(body);}
}

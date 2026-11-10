import {Matrix4,Quaternion,Vector3} from 'three';
import type {RigidBody3D} from './rigid-body-3d';
export const PEDESTRIAN_MASS=68.8;
/** Gameplay coupling: a yielding pedestrian must not behave like an anchored obstacle. */
export const PEDESTRIAN_CAR_REACTION=.25;
/** Swept upright capsule envelope against the car OBB. Previous position prevents tunnelling at driving speeds. */
export function pedestrianCarContact(feet:Vector3,height:number,radius:number,walkingVelocity:Vector3,car:RigidBody3D,previousFrame:Matrix4){
  const current=car.matrix(),inverse=current.clone().invert(),center=feet.clone().add(new Vector3(0,height/2,0));
  const now=center.clone().applyMatrix4(inverse),old=center.clone().applyMatrix4(previousFrame.clone().invert());
  const pad=new Vector3(radius,height/2,radius),box=car.bounds.clone().expandByVector(pad),movement=now.clone().sub(old);
  let enter=0,leave=1,axis=-1,sign=1;
  for(let i=0;i<3;i++){
    const p=old.getComponent(i),v=movement.getComponent(i),min=box.min.getComponent(i),max=box.max.getComponent(i);
    if(Math.abs(v)<1e-9){if(p<min||p>max)return;continue;}
    let a=(min-p)/v,b=(max-p)/v,s=-1;if(a>b){[a,b]=[b,a];s=1;}
    if(a>enter){enter=a;axis=i;sign=s;}leave=Math.min(leave,b);if(enter>leave)return;
  }
  if(enter<0||enter>1||leave<0)return;
  const local=old.clone().lerp(now,enter),closest=local.clone().clamp(car.bounds.min,car.bounds.max),normal=new Vector3();
  if(axis>=0)normal.setComponent(axis,sign);else{
    let gap=Infinity;for(let i=0;i<3;i++)for(const s of [-1,1]){const d=Math.abs(local.getComponent(i)-(s<0?box.min:box.max).getComponent(i));if(d<gap){gap=d;normal.set(0,0,0).setComponent(i,s);}}
  }
  const rotation=new Quaternion();current.decompose(new Vector3(),rotation,new Vector3());normal.applyQuaternion(rotation);
  // Contact location is on the body surface at the swept time, not the car's later position.
  const atImpact=new Matrix4().compose(new Vector3().setFromMatrixPosition(previousFrame).lerp(new Vector3().setFromMatrixPosition(current),enter),rotation,new Vector3(1,1,1));
  const point=closest.applyMatrix4(atImpact),relative=car.pointVelocity(point).sub(walkingVelocity),closing=relative.dot(normal);
  if(closing<.25)return;
  const lever=point.clone().sub(car.position),cross=lever.clone().cross(normal),personCross=point.clone().sub(center).cross(normal),transverse=PEDESTRIAN_MASS*(height*height/12+radius*radius/4),axial=PEDESTRIAN_MASS*radius*radius/2;
  const personRotation=(personCross.x*personCross.x+personCross.z*personCross.z)/transverse+personCross.y*personCross.y/axial;
  const effective=1/PEDESTRIAN_MASS+personRotation+1/car.mass+normal.dot(car.inverseWorld(cross).cross(lever));
  const impulse=normal.multiplyScalar(1.05*closing/Math.max(effective,1e-6));
  return {point,impulse,fraction:enter};
}
export interface RagdollCar {
  key:object;center:Vector3;rotation:Quaternion;half:Vector3;velocity:Vector3;angularVelocity:Vector3;
  impulse:(impulse:Vector3,point:Vector3)=>void;
}
export function ragdollCar(car:RigidBody3D):RagdollCar{
  const center=car.bounds.getCenter(new Vector3()).applyMatrix4(car.matrix());return {key:car,center,rotation:car.orientation.clone(),half:car.bounds.getSize(new Vector3()).multiplyScalar(.5),velocity:car.pointVelocity(center),angularVelocity:car.omega,impulse:(j,p)=>car.impulse(j,p)};
}

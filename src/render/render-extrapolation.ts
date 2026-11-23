import {Matrix4,Quaternion,Vector3} from 'three';

interface MovingBody {readonly position:Vector3;readonly velocity:Vector3;readonly omega:Vector3}

const spin=new Quaternion(),pivot=new Vector3(),axis=new Vector3();

/**
 * World-space transform that carries a body's last fixed-tick pose `seconds` forward along its velocity and
 * spin. Physics advances in whole ticks, so at a display rate that is not a multiple of the tick rate each frame
 * shows a pose that is 0..1 tick stale by a different amount; rendering that pose directly makes motion judder
 * far worse than the frame rate suggests. Premultiplying every visual of the body by this matrix shows it where
 * it is at render time instead. Rotation is about the centre of mass, the same integration the solver uses.
 */
export function extrapolationMatrix(body:MovingBody,seconds:number,out=new Matrix4()):Matrix4 {
  if(!(seconds>0))return out.identity();
  const rate=axis.copy(body.omega).length();
  if(rate*seconds>1e-9)spin.setFromAxisAngle(axis.multiplyScalar(1/rate),rate*seconds);else spin.identity();
  out.makeRotationFromQuaternion(spin);
  // C·x = R(x - p) + p + v·t
  pivot.copy(body.position).applyQuaternion(spin).negate().add(body.position).addScaledVector(body.velocity,seconds);
  return out.setPosition(pivot);
}

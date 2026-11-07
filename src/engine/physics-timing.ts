/** Baseline time constants stay fixed while the experiment changes integration rate. */
export const REFERENCE_PHYSICS_HZ=240;
export const DRIVING_PHYSICS_HZ=120;
export const XPBD_ITERATIONS=12;
export const COLLISION_GEOMETRY_HZ=60;
export const DAMAGE_SAMPLE_HZ=10;
export const MOUNT_RELEASE_DELAY_S=2/REFERENCE_PHYSICS_HZ;
export function physicsTickBudget(hz:number){
  if(!Number.isInteger(hz)||hz<60||hz%60)throw Error('Physics frequency must be a positive multiple of 60 Hz');
  return Math.max(1,Math.round(64*hz/REFERENCE_PHYSICS_HZ));
}

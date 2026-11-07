import type {InstancedMesh} from 'three';

let nextPlacementId=1;
/** IDs belong to map entries, independent of coordinates, stream slots or mesh parts. */
export function allocateMapPlacementIds(count:number):number[]{
  if(!Number.isSafeInteger(count)||count<0||nextPlacementId+count>Number.MAX_SAFE_INTEGER)throw Error('Map placement ID capacity exceeded');
  return Array.from({length:count},()=>nextPlacementId++);
}
/** Publish a new immutable slot mapping; pending Hi-Z tickets keep the previous array. */
export function setMapPlacementIds(mesh:InstancedMesh,ids:readonly number[]){
  mesh.userData.mapPlacementIds=ids.slice();
  mesh.userData.mapPlacementVersion=(mesh.userData.mapPlacementVersion??0)+1;
}

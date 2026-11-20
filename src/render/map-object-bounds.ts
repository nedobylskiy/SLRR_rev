import {Box3,Sphere,type Mesh} from 'three';

/** Render parts stay separate, but culling must accept/reject the complete object. */
export function useWholeObjectBounds(parts:readonly Mesh[]){
  const bounds=new Box3();
  for(const part of parts){
    if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox!);
  }
  if(bounds.isEmpty())return;
  for(const part of parts){
    part.geometry.boundingBox=bounds.clone();
    part.geometry.boundingSphere=bounds.getBoundingSphere(new Sphere());
  }
}

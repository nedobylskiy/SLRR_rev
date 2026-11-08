import { Mesh, type Group, type Object3D, type Raycaster, type Intersection } from 'three';

/** Pick rendered part geometry only. Raycaster itself does not honor hierarchy visibility. */
export function intersectPartGeometry(ray: Raycaster, groups: readonly Group[]): Intersection<Object3D> | undefined {
  const meshes: Mesh[] = [];
  for (const group of groups) group.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(materials.some(material=>material.visible&&material.opacity>0))meshes.push(object);
  });
  // Non-recursive: sprites, lights, helpers and children of hidden CFG channels never enter the test.
  return ray.intersectObjects(meshes,false).find(hit=>{
    const mesh=hit.object as Mesh;
    const material=Array.isArray(mesh.material)?mesh.material[hit.face?.materialIndex??0]:mesh.material;
    return material?.visible&&material.opacity>0;
  });
}

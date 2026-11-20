import {parseScxAsync} from '../formats/scx-worker-client';
import { Box3, BoxGeometry, Matrix4, SphereGeometry, Vector3 } from 'three';
import { Assets, normalizePath } from '../assets';

import { modelMatrix } from './model-transform';
import { poseMatrix, type PartDefinition } from './world';

/** Original CFG body meshes, including their metre poses; water/nocollision bodies are excluded. */
export async function loadPartCollision(assets: Assets, definition: PartDefinition): Promise<number[]> {
  const triangles: number[] = [], point = new Vector3();
  for (const body of definition.config.bodies) {
    if (body.collision === false) continue;
    const path = body.shape[0];
    const primitive=bodyPrimitive(body.shape);
    if(primitive){appendGeometry(triangles,primitive,poseMatrix(body));continue;}
    if (!/\.scx$/i.test(path)) continue;
    if (!assets.byPath.has(normalizePath(path))) throw new Error(`Physical SCX missing: ${path} (${definition.cfgPath})`);
    const model = await parseScxAsync(await assets.read(path)), transform = modelMatrix(new Matrix4(), poseMatrix(body));
    for (const mesh of model.meshes) for (const index of mesh.indices) {
      point.fromArray(mesh.positions, index * 3).applyMatrix4(transform); triangles.push(point.x, point.y, point.z);
    }
  }
  return triangles;
}

function bodyPrimitive(shape:readonly string[]){
  const values=shape.slice(1).map(Number);
  if(shape[0]==='box'&&values.length>=3&&values.slice(0,3).every(v=>v>0&&Number.isFinite(v)))return new BoxGeometry(values[0]*2,values[1]*2,values[2]*2);
  if(shape[0]==='sphere'&&values[0]>0){const g=new SphereGeometry(1,8,4);g.scale(values[0],values[1]>0?values[1]:values[0],values[2]>0?values[2]:values[0]);return g;}
}
function appendGeometry(out:number[],geometry:BoxGeometry|SphereGeometry,frame:Matrix4){
  const p=geometry.getAttribute('position'),ids=geometry.getIndex()!,point=new Vector3();
  for(let i=0;i<ids.count;i++){point.fromBufferAttribute(p,ids.getX(i)).applyMatrix4(frame);out.push(point.x,point.y,point.z);}geometry.dispose();
}
/** Never substitute the detailed render triangles for a missing physical body. */
export function partContactTriangles(definition:PartDefinition,physical:readonly number[],samples:readonly number[]):number[]{
  if(physical.length)return Array.from(physical);
  // Explicit nocollision bodies are intentional, including tiny water/mass bodies.
  if(definition.config.bodies.length)return [];
  const bounds=new Box3(),point=new Vector3();for(let i=0;i<samples.length;i+=3)bounds.expandByPoint(point.fromArray(samples,i));
  if(bounds.isEmpty())return [];
  const size=bounds.getSize(new Vector3());size.max(new Vector3(.01,.01,.01));
  const out:number[]=[];appendGeometry(out,new BoxGeometry(size.x,size.y,size.z),new Matrix4().setPosition(bounds.getCenter(point)));return out;
}

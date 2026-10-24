import { Matrix4, Vector3 } from 'three';
import { Assets, normalizePath } from '../assets';
import { parseScx } from '../formats/scx';
import { modelMatrix } from './model-transform';
import { poseMatrix, type PartDefinition } from './world';

/** Original CFG body meshes, including their metre poses; water/nocollision bodies are excluded. */
export async function loadPartCollision(assets: Assets, definition: PartDefinition): Promise<number[]> {
  const triangles: number[] = [], point = new Vector3();
  for (const body of definition.config.bodies) {
    if (body.collision === false) continue;
    const path = body.shape[0];
    if (!/\.scx$/i.test(path) || !assets.byPath.has(normalizePath(path))) continue;
    const model = parseScx(await assets.read(path)), transform = modelMatrix(new Matrix4(), poseMatrix(body));
    for (const mesh of model.meshes) for (const index of mesh.indices) {
      point.fromArray(mesh.positions, index * 3).applyMatrix4(transform); triangles.push(point.x, point.y, point.z);
    }
  }
  return triangles;
}

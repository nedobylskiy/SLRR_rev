import { BufferAttribute, Group, Matrix4, Mesh, Triangle, Vector3, type BufferGeometry, type Object3D } from 'three';
import { fullGeometry } from './lod-library';

interface SurfaceTriangle {
  position: BufferAttribute; ids: [number,number,number]; triangle: Triangle;
}
interface Binding { surface: SurfaceTriangle; weights: [number,number,number] }
interface PaintMesh {
  mesh: Mesh; geometry: BufferGeometry; original: Float32Array; normals?: Float32Array;
  bindings: Binding[]; inverseLocal: Matrix4; culled: boolean;
}

function relativeMatrix(mesh: Mesh, root: Group) {
  const matrix = new Matrix4();
  for (let node: Object3D | null = mesh; node && node !== root; node = node.parent) {
    if (node.matrixAutoUpdate) node.updateMatrix();
    matrix.premultiply(node.matrix);
  }
  return matrix;
}

/** Decals share the rendered triangles' deformation, without adding solver nodes. */
export class PanelPaintSkin {
  private meshes: PaintMesh[] = [];
  get active() { return this.meshes.length > 0; }
  constructor(group: Group, surfaces: readonly Mesh[]) {
    const overlays: Mesh[] = [];
    (group.userData.paintStrokeGroup as Group | undefined)?.traverse(object => {
      if (object instanceof Mesh && object.userData.paintStroke) overlays.push(object);
    });
    if (!overlays.length) return;
    const triangles: SurfaceTriangle[] = [];
    for (const mesh of surfaces) {
      const full = fullGeometry(mesh), position = full.getAttribute('position') as BufferAttribute, indices = full.index;
      const matrix = relativeMatrix(mesh, group), count = indices?.count ?? position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const ids = [0,1,2].map(j => indices ? indices.getX(i+j) : i+j) as [number,number,number];
        const points = ids.map(id => new Vector3().fromBufferAttribute(position,id).applyMatrix4(matrix));
        if (points[0].clone().sub(points[1]).cross(points[2].clone().sub(points[1])).lengthSq() < 1e-16) continue;
        triangles.push({ position, ids, triangle: new Triangle(points[0],points[1],points[2]) });
      }
    }
    if (!triangles.length) return;
    const point = new Vector3(), closest = new Vector3(), barycentric = new Vector3();
    for (const mesh of overlays) {
      const geometry = mesh.geometry, position = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      const matrix = relativeMatrix(mesh,group), bindings: Binding[] = [];
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position,i).applyMatrix4(matrix);
        let best = Infinity, binding: Binding | undefined;
        for (const surface of triangles) {
          surface.triangle.closestPointToPoint(point,closest);
          const distance = point.distanceToSquared(closest);
          if (distance >= best) continue;
          surface.triangle.getBarycoord(closest,barycentric);
          binding = { surface, weights: barycentric.toArray() as [number,number,number] }; best = distance;
          if (distance < 1e-12) break;
        }
        bindings.push(binding!);
      }
      this.meshes.push({ mesh, geometry, bindings, inverseLocal: matrix.invert(),
        original: new Float32Array(position.array), normals: normals && new Float32Array(normals.array), culled: mesh.frustumCulled });
      mesh.frustumCulled = false;
    }
  }
  update(inverseDrawFrame: Matrix4) {
    if (!this.meshes.length) return;
    const point = new Vector3(), vertex = new Vector3();
    for (const skin of this.meshes) {
      const inverse = skin.inverseLocal.clone().multiply(inverseDrawFrame), position = skin.geometry.getAttribute('position');
      skin.bindings.forEach(({surface,weights},i) => {
        point.set(0,0,0);
        for (let j = 0; j < 3; j++) point.addScaledVector(vertex.fromBufferAttribute(surface.position,surface.ids[j]),weights[j]);
        point.applyMatrix4(inverse); position.setXYZ(i,point.x,point.y,point.z);
      });
      position.needsUpdate = true; skin.geometry.computeVertexNormals();
      skin.geometry.computeBoundingBox(); skin.geometry.computeBoundingSphere();
    }
  }
  dispose() {
    for (const skin of this.meshes) {
      const position = skin.geometry.getAttribute('position'); position.array.set(skin.original); position.needsUpdate = true;
      if (skin.normals) { const normals = skin.geometry.getAttribute('normal'); normals.array.set(skin.normals); normals.needsUpdate = true; }
      skin.mesh.frustumCulled = skin.culled; skin.geometry.computeBoundingBox(); skin.geometry.computeBoundingSphere();
    }
    this.meshes = [];
  }
}

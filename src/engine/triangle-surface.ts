import { Box3, Matrix4, Triangle, Vector3 } from 'three';
import type { PanelContact, PanelSurface, Triple } from './deformable-panel';

export interface SurfaceRange {start:number;count:number}
interface Face { owner?:Branch;triangle: Triangle; bounds: Box3; normal: Vector3; offset: number; active: boolean }
interface Branch { parent?:Branch;bounds: Box3; faces?: Face[]; left?: Branch; right?: Branch }
interface QueryCache { revision: number; bounds: Box3; faces: Face[] }
/** Two-sided swept node/sphere contacts against the assembled body's original triangles, in body space. */
export class TriangleSurface implements PanelSurface {
  private tree: Branch;
  private faces: Face[] = [];
  private faceSlots:Face[]=[];
  lastRefitTriangles=0;
  lastRefitBranches=0;
  private coordinateCount: number;
  get coordinateLength(){return this.coordinateCount;}
  private inverse = new Matrix4(); private previousInverse = new Matrix4(); private frame = new Matrix4();
  private from = new Vector3(); private to = new Vector3(); private query = new Box3();
  private queries = new WeakMap<Float64Array, QueryCache[]>();
  private revision = 0;
  private stack: Branch[] = [];
  private center = new Vector3(); private surface = new Vector3(); private closest = new Vector3(); private delta = new Vector3();
  private hit = new Vector3(); private hitNormal = new Vector3();
  readonly radius = 0.035;
  hits = 0;
  constructor(triangles: ArrayLike<number>, private enabled: () => boolean, private velocity: (point: Vector3) => Vector3, private reaction: (impulse: Triple, point: Triple) => void) {
    if (!triangles.length || triangles.length % 9) throw new Error('Triangle surface requires triangles');
    this.coordinateCount = triangles.length;
    const faces = this.faces; let valid = 0;
    for (let i = 0; i < triangles.length; i += 9) {
      const t = new Triangle(new Vector3().fromArray(triangles, i), new Vector3().fromArray(triangles, i + 3), new Vector3().fromArray(triangles, i + 6));
      if (![...t.a.toArray(), ...t.b.toArray(), ...t.c.toArray()].every(Number.isFinite)) throw new Error('Invalid collision triangle');
      const active = t.getArea() >= 1e-10; if (active) valid++;
      const face={ triangle:t,normal:t.getNormal(new Vector3()),bounds:new Box3().setFromPoints([t.a,t.b,t.c]),offset:i,active };
      faces.push(face);this.faceSlots.push(face);
    }
    if (!valid) throw new Error('Empty collision surface'); this.tree = this.build(faces);
  }
  setFrames(previous: Matrix4, current: Matrix4) { this.previousInverse.copy(previous).invert(); this.inverse.copy(current).invert(); this.frame.copy(current); }
  /** Same triangle order/topology: update bounds bottom-up without sorting or allocating a new BVH. */
  refit(triangles: ArrayLike<number>,ranges?:readonly SurfaceRange[]) {
    if (triangles.length !== this.coordinateCount) throw new Error('Refit requires unchanged triangle topology');
    const work=ranges??[{start:0,count:triangles.length}];
    // Validate before mutating any faces. Ranges use coordinate offsets, aligned to triangles.
    for(const {start,count} of work){
      if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<0||start%9||count%9||start+count>triangles.length)throw Error('Invalid refit range');
      for(let i=start;i<start+count;i++)if(!Number.isFinite(triangles[i]))throw Error('Invalid collision triangle');
    }
    this.lastRefitTriangles=this.lastRefitBranches=0;
    if(!work.some(r=>r.count))return;
    const dirty=ranges?new Set<Branch>():undefined;
    for(const {start,count} of work)for(let offset=start;offset<start+count;offset+=9){
      const face=this.faceSlots[offset/9],t=face.triangle;
      t.a.fromArray(triangles,offset);t.b.fromArray(triangles,offset+3);t.c.fromArray(triangles,offset+6);
      face.active=t.getArea()>=1e-10;face.bounds.makeEmpty();
      if(face.active){t.getNormal(face.normal);face.bounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);}
      this.lastRefitTriangles++;
      if(dirty)for(let node=face.owner;node&&!dirty.has(node);node=node.parent)dirty.add(node);
    }
    const visit=(branch:Branch)=>{
      if(dirty&&!dirty.has(branch))return;
      this.lastRefitBranches++;branch.bounds.makeEmpty();
      if(branch.faces)for(const face of branch.faces)branch.bounds.union(face.bounds);
      else{visit(branch.left!);visit(branch.right!);branch.bounds.union(branch.left!.bounds).union(branch.right!.bounds);}
    };
    visit(this.tree);this.revision++;
  }
  reset() { this.hits = 0; }
  intersectsWorld(bounds: Box3) { return bounds.clone().applyMatrix4(this.inverse).expandByScalar(this.radius).intersectsBox(this.tree.bounds); }
  roofPoint() {
    const top = this.tree.bounds.max.y, center = new Vector3(); let weight = 0;
    const visit = (branch: Branch) => { if (branch.faces) for (const face of branch.faces) { if (face.bounds.max.y > top - 0.12 && Math.abs(face.normal.y) > 0.7) { const area = face.triangle.getArea(); center.addScaledVector(face.triangle.getMidpoint(new Vector3()), area); weight += area; } } else { visit(branch.left!); visit(branch.right!); } }; visit(this.tree);
    if (!weight) return this.tree.bounds.getCenter(center).setY(top); return center.multiplyScalar(1 / weight).setY(top);
  }
  private build(faces: Face[]): Branch {
    const bounds = new Box3(); faces.forEach(f => bounds.union(f.bounds));
    if (faces.length <= 8) {const leaf={bounds,faces};for(const face of faces)face.owner=leaf;return leaf;}
    const size = bounds.getSize(new Vector3()), axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    faces.sort((a, b) => a.bounds.min[axis] + a.bounds.max[axis] - b.bounds.min[axis] - b.bounds.max[axis]);
    const mid=Math.floor(faces.length/2),branch:Branch={bounds,left:this.build(faces.slice(0,mid)),right:this.build(faces.slice(mid))};
    branch.left!.parent=branch;branch.right!.parent=branch;return branch;
  }
  project(p: Float64Array, previous: Float64Array, offset: number): PanelContact | undefined {
    if (!this.enabled()) return;
    const from = this.from.fromArray(previous, offset).applyMatrix4(this.previousInverse), to = this.to.fromArray(p, offset).applyMatrix4(this.inverse);
    const query = this.query.makeEmpty().expandByPoint(from).expandByPoint(to).expandByScalar(this.radius);
    let entries = this.queries.get(previous);
    if (!entries) { entries = []; this.queries.set(previous, entries); }
    let cache = entries[offset / 3];
    if (!cache) cache = entries[offset / 3] = { revision: -1, bounds: new Box3(), faces: [] };
    // XPBD visits a node repeatedly within a tick. Reuse only a conservative candidate set;
    // movement outside its body-local bounds or a geometry refit triggers a fresh query.
    if (cache.revision !== this.revision || !cache.bounds.containsBox(query)) {
      cache.revision = this.revision; cache.bounds.copy(query).expandByScalar(0.02); cache.faces.length = 0;
      const stack = this.stack; stack.length = 0; stack.push(this.tree);
      while (stack.length) {
        const branch = stack.pop()!;
        if (!cache.bounds.intersectsBox(branch.bounds)) continue;
        if (branch.faces) { for (const face of branch.faces) if (cache.bounds.intersectsBox(face.bounds)) cache.faces.push(face); }
        else { stack.push(branch.right!, branch.left!); }
      }
    }
    let first = Infinity, found = false;
    const hit = this.hit, normal = this.hitNormal;
    for (const { triangle, normal: n, bounds, active } of cache.faces) {
      if (!active || !query.intersectsBox(bounds)) continue;
      const a = this.delta.subVectors(from, triangle.a).dot(n), b = this.delta.subVectors(to, triangle.a).dot(n), sign = a < 0 ? -1 : 1;
      if (sign * b < this.radius && sign * a > sign * b) {
        const time = Math.max(0, (sign * a - this.radius) / (sign * a - sign * b)), center = this.center.copy(from).lerp(to, time), surface = this.surface.copy(center).addScaledVector(n, -this.delta.subVectors(center, triangle.a).dot(n));
        if (time >= 0 && time <= 1 && time < first && triangle.containsPoint(surface)) {
          first = time; normal.copy(n).multiplyScalar(sign);
          // Stop at the swept contact, rather than projecting a distant end point onto the
          // infinite face plane (which could put it beyond the triangle and inside the body).
          hit.copy(surface).addScaledVector(normal, this.radius); found = true;
        }
      }
      // Resting contact and triangle edges, including small pre-existing penetrations of the contact shell.
      if (first !== Infinity || to.x < bounds.min.x - this.radius || to.x > bounds.max.x + this.radius || to.y < bounds.min.y - this.radius || to.y > bounds.max.y + this.radius || to.z < bounds.min.z - this.radius || to.z > bounds.max.z + this.radius) continue;
      const closest = triangle.closestPointToPoint(to, this.closest), delta = this.delta.subVectors(to, closest), distance = delta.length();
      if (distance < this.radius && first === Infinity) { if (distance > 1e-8) normal.copy(delta).multiplyScalar(1 / distance); else normal.copy(n).multiplyScalar(sign); hit.copy(closest).addScaledVector(normal, this.radius); found = true; }
    }
    if (!found) return;
    const world = hit.applyMatrix4(this.frame), worldNormal = normal.transformDirection(this.frame);
    world.toArray(p, offset); this.hits++;
    return { point: world.toArray() as Triple, normal: worldNormal.toArray() as Triple, velocity: this.velocity(world).toArray() as Triple, restitution: 0.18, friction: 0.55, impulse: this.reaction };
  }
}

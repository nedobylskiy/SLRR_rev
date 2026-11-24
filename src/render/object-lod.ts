import {Mesh,NormalBlending,SkinnedMesh,Vector3,type BufferGeometry,type Material,type Object3D} from 'three';
import {lodLevel} from './lod-distance';
import {LodLibrary} from './lod-library';

interface Entry {
  mesh:Mesh;
  /** Geometry whose triangles were simplified (a layer pass shares its base mesh's topology). */
  topology:BufferGeometry;
  /** Full-detail geometry the owner wants shown; replaced when an owner swaps in a dented copy. */
  current:BufferGeometry;
  installed:BufferGeometry;
}
interface Tracked {root:Object3D;entries:Entry[];level:number}

const position=new Vector3(),local=new Vector3();

/** Lamp beams and additive glows are light shapes, not surfaces; collapsing them would switch lights off. */
function shown(object:Object3D){for(let o:Object3D|null=object;o;o=o.parent)if(!o.visible)return false;return true;}
function surface(mesh:Mesh,skinned:boolean){
  if(mesh instanceof SkinnedMesh&&!skinned||!mesh.isMesh||mesh.userData.lodExcluded)return false;
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]) as Material[];
  if(materials.some(m=>m.blending!==NormalBlending))return false;
  for(let node:Object3D|null=mesh;node;node=node.parent)if(node.name==='CFG lamp flare'||node.userData.disposeVehicleLight||node.userData.paintStroke)return false;
  return true;
}

/**
 * Distance LOD for whole objects such as vehicles: every mesh of a root switches level together. A level is a
 * geometry view sharing the mesh's vertex buffers, so swapping is a pointer change and dents stay visible.
 */
export class ObjectLod {
  private tracked=new Map<Object3D,Tracked>();
  /** Roots with nothing to simplify, so per-frame track() calls stay a lookup. */
  private empty=[new WeakSet<Object3D>(),new WeakSet<Object3D>()];
  enabled=true;
  constructor(readonly library:LodLibrary){}
  get size(){return this.tracked.size;}
  levelOf(root:Object3D){return this.tracked.get(root)?.level??0;}
  /**
   * One simplification job per root, so small parts of that model collapse before its large panels.
   * `skinned` admits skinned characters: a level only drops triangles, so skin indices and weights stay shared.
   */
  track(root:Object3D,priority=0,{skinned=false}:{skinned?:boolean}={}){
    const empty=this.empty[+skinned];
    if(this.tracked.has(root)||empty.has(root))return;
    const entries:Entry[]=[],byName=new Map<string,Entry>();
    root.traverse(object=>{
      if(!(object instanceof Mesh)||!surface(object,skinned))return;
      const geometry=object.geometry as BufferGeometry;
      if(!LodLibrary.eligible(geometry))return;
      const base=object.name.endsWith(' / layer2')?byName.get(`${object.parent?.uuid}:${object.name.slice(0,-9)}`):undefined;
      const entry:Entry={mesh:object,topology:base?.topology??geometry,current:geometry,installed:geometry};
      entries.push(entry);byName.set(`${object.parent?.uuid}:${object.name}`,entry);
    });
    if(!entries.length){empty.add(root);return;}
    this.tracked.set(root,{root,entries,level:0});
    this.library.request(entries.filter(e=>e.topology===e.current).map(e=>e.topology),priority);
  }
  /** Restore full detail before the owner disposes or reuses the meshes. */
  untrack(root:Object3D){const tracked=this.tracked.get(root);if(!tracked)return;this.install(tracked,0);this.tracked.delete(root);}
  untrackWithin(parent:Object3D){for(const root of [...this.tracked.keys()])for(let node:Object3D|null=root;node;node=node.parent)if(node===parent){this.untrack(root);break;}}
  update(camera:Vector3,far:number){
    for(const tracked of this.tracked.values()){
      // Hidden roots (parked traffic, pooled pedestrians) keep their level until they are drawn again.
      if(this.enabled&&!shown(tracked.root))continue;
      let level=0;
      if(this.enabled){
        level=lodLevel(this.anchor(tracked).distanceTo(camera),far,tracked.level);
      }
      // Owners may swap geometry at any time (dents, panel resets); re-install on every change.
      const swapped=tracked.entries.some(e=>e.mesh.geometry!==e.installed);
      if(level!==tracked.level||swapped)this.install(tracked,level);
    }
  }
  /**
   * A drawn vertex, not the root's origin: deforming body panels park their group at the identity and write
   * world-space vertices, so the group origin can sit hundreds of metres from the visible car.
   */
  private anchor(tracked:Tracked){
    const entry=tracked.entries[0],attribute=entry.current.getAttribute('position');
    // Skinned vertices are in bind pose; a walking or ragdolling body is wherever its root bone is. Read the
    // last rendered pose instead of recomputing it, so physics-driven bone matrices are left untouched.
    const bone=entry.mesh instanceof SkinnedMesh?entry.mesh.skeleton?.bones[0]:undefined;
    if(bone)return position.setFromMatrixPosition(bone.matrixWorld);
    entry.mesh.updateWorldMatrix(true,false);
    return position.copy(local.fromBufferAttribute(attribute,0)).applyMatrix4(entry.mesh.matrixWorld);
  }
  private install(tracked:Tracked,level:number){
    tracked.level=level;
    for(const entry of tracked.entries){
      const shown=entry.mesh.geometry;
      if(shown!==entry.installed)entry.current=(shown.userData.lodFull as BufferGeometry|undefined)??shown;
      const next=this.library.view(entry.current,entry.topology,level);
      entry.mesh.geometry=next;entry.installed=next;
    }
  }
  /** Re-apply after levels finish generating. */
  refresh(){for(const tracked of this.tracked.values())this.install(tracked,tracked.level);}
  dispose(){for(const root of [...this.tracked.keys()])this.untrack(root);}
}

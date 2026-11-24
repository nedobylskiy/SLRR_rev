import {BufferAttribute,BufferGeometry,InterleavedBufferAttribute,Mesh,type Object3D,type Material,type MeshStandardMaterial,type Texture} from 'three';
import type {LodMode,LodResult,LodSection} from './lod-simplify';
import {reduceTexture,textureBytes,textureSize} from './texture-lod';

export interface LodSettings {ratio:number;mode:LodMode;/** Mip levels to drop; 'auto' follows the achieved triangle ratio. */textureLevels:number|'auto'}
interface Entry {mesh:Mesh;source:BufferGeometry;visible:boolean;section:number}
const textureSlots=['map','lightMap','emissiveMap','alphaMap'] as const;
type TextureSlot=typeof textureSlots[number];

/** Copy only referenced vertices, so the preview's vertex count and buffers are what an LOD would upload. */
function compact(source:BufferGeometry,indices:Uint32Array):BufferGeometry {
  const remap=new Map<number,number>(),order:number[]=[],index=new Uint32Array(indices.length);
  for(let i=0;i<indices.length;i++){
    let target=remap.get(indices[i]);
    if(target===undefined){target=order.length;remap.set(indices[i],target);order.push(indices[i]);}
    index[i]=target;
  }
  const result=new BufferGeometry();
  for(const [name,attribute] of Object.entries(source.attributes)){
    const from=attribute as BufferAttribute|InterleavedBufferAttribute,size=from.itemSize;
    const source=from instanceof InterleavedBufferAttribute?from.data.array:from.array;
    const target=new BufferAttribute(new (source.constructor as new (n:number)=>typeof source)(order.length*size),size,from.normalized);
    // getComponent denormalizes and setComponent normalizes back, so Uint8 colours keep their 0..255 range.
    for(let v=0;v<order.length;v++)for(let j=0;j<size;j++)target.setComponent(v,j,from.getComponent(order[v],j));
    result.setAttribute(name,target);
  }
  result.setIndex(new BufferAttribute(index,1));result.computeBoundingBox();result.computeBoundingSphere();
  return result;
}

function sectionData(geometry:BufferGeometry):LodSection {
  const attributes:LodSection['attributes']={};
  for(const [name,attribute] of Object.entries(geometry.attributes)){
    const from=attribute as BufferAttribute|InterleavedBufferAttribute,array=new Float32Array(from.count*from.itemSize);
    // getComponent already denormalizes.
    for(let i=0;i<from.count;i++)for(let j=0;j<from.itemSize;j++)array[i*from.itemSize+j]=from.getComponent(i,j);
    attributes[name]={array,itemSize:from.itemSize};
  }
  const index=geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:geometry.getAttribute('position').count},(_,i)=>i);
  return {index,attributes};
}

export class LodPlayground {
  private entries:Entry[]=[];
  private sections:LodSection[]=[];
  private originals=new Map<MeshStandardMaterial,Partial<Record<TextureSlot,Texture|null>>>();
  private reduced=new Map<string,Texture|undefined>();
  private worker?:Worker;
  private timer?:ReturnType<typeof setTimeout>;
  private revision=0;
  private disposed=false;
  private result?:LodResult;
  private levels=0;
  constructor(root:Object3D){
    const bases=new Map<string,Entry>();
    root.traverse(object=>{
      if(!(object instanceof Mesh)||!object.geometry.getAttribute('position'))return;
      // A transparent second texture pass is a clone of its base geometry: reuse the base result so they stay coplanar.
      const base=object.name.endsWith(' / layer2')?bases.get(object.name.slice(0,-9)):undefined;
      const compatible=base&&base.source.getAttribute('position').count===object.geometry.getAttribute('position').count
        &&base.source.index?.count===object.geometry.index?.count;
      const entry:Entry={mesh:object,source:object.geometry,visible:object.visible,section:compatible?base.section:this.sections.length};
      if(!compatible)this.sections.push(sectionData(object.geometry));
      this.entries.push(entry);if(!base)bases.set(object.name,entry);
      for(const material of (Array.isArray(object.material)?object.material:[object.material]) as MeshStandardMaterial[]){
        if(this.originals.has(material))continue;
        const slots:Partial<Record<TextureSlot,Texture|null>>={};
        for(const slot of textureSlots)if(slot in material)slots[slot]=material[slot];
        this.originals.set(material,slots);
      }
    });
  }
  private triangles(geometry:BufferGeometry){return (geometry.index?.count??geometry.getAttribute('position')?.count??0)/3;}
  private textures(){
    const unique=new Map<string,Texture>();
    for(const material of this.originals.keys())for(const slot of textureSlots){const t=material[slot];if(t)unique.set(t.uuid,t);}
    return [...unique.values()];
  }
  info(){
    const shown=this.entries.filter(e=>e.mesh.visible);
    const before=this.entries.reduce((n,e)=>n+this.triangles(e.source),0),after=shown.reduce((n,e)=>n+this.triangles(e.mesh.geometry),0);
    const vertices=(entries:Entry[],geometry:(e:Entry)=>BufferGeometry)=>entries.reduce((n,e)=>n+geometry(e).getAttribute('position').count,0);
    const original=[...new Map([...this.originals.values()].flatMap(slots=>Object.values(slots)).filter((t):t is Texture=>!!t).map(t=>[t.uuid,t])).values()];
    const mb=(textures:Texture[])=>(textures.reduce((n,t)=>n+textureBytes(t),0)/1048576).toFixed(2);
    const largest=(textures:Texture[])=>textures.map(textureSize).sort((a,b)=>b[0]*b[1]-a[0]*a[1])[0];
    const [w0,h0]=largest(original)??[0,0],[w1,h1]=largest(this.textures())??[0,0];
    const dropped=this.entries.filter(e=>e.visible&&!e.mesh.visible).length;
    return [
      `${Math.round(before).toLocaleString('en-US')} → ${Math.round(after).toLocaleString('en-US')} triangles (${before?Math.round(after/before*100):100}%)`,
      `${vertices(this.entries,e=>e.source).toLocaleString('en-US')} → ${vertices(shown,e=>e.mesh.geometry).toLocaleString('en-US')} vertices`,
      this.result?.error?`error ${(this.result.error*100).toFixed(2)}% of diagonal`:'',
      this.result?.relaxedSeams?'seams relaxed to reach budget':'',
      dropped?`${dropped} sections dropped`:'',
      original.length?`textures ${mb(original)} → ${mb(this.textures())} MB · largest ${w0}×${h0} → ${w1}×${h1}${this.levels?` (−${this.levels} mip)`:''}`:'no textures bound',
    ].filter(Boolean).join(' · ');
  }
  wireframe(enabled:boolean){for(const {mesh} of this.entries)for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]) as (Material&{wireframe?:boolean})[])material.wireframe=enabled;}
  apply(settings:LodSettings,changed:(message:string)=>void){
    if(this.disposed)return;
    const revision=++this.revision;clearTimeout(this.timer);this.worker?.terminate();this.worker=undefined;
    const finish=(result?:LodResult)=>{
      this.result=result;
      const achieved=result&&result.sourceTriangles?result.triangles/result.sourceTriangles:1;
      // Screen area ∝ triangles at a fixed density, texel area likewise: one mip per 4× fewer triangles.
      this.setTextureLevels(settings.textureLevels==='auto'?Math.max(0,Math.round(-.5*Math.log2(Math.max(achieved,1e-4)))):settings.textureLevels);
      changed(this.info());
    };
    if(settings.ratio>=1){this.restoreGeometry();finish();return;}
    changed(`${this.info()} · simplifying…`);
    this.timer=setTimeout(()=>{
      if(this.disposed||revision!==this.revision)return;
      const worker=this.worker=new Worker(new URL('./lod-playground-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=(event:MessageEvent<{result?:LodResult;error?:string}>)=>{
        if(this.disposed||revision!==this.revision)return;
        worker.terminate();this.worker=undefined;
        if(!event.data.result){changed(`Simplification failed: ${event.data.error}`);return;}
        const result=event.data.result;
        for(const entry of this.entries){
          if(entry.mesh.geometry!==entry.source)entry.mesh.geometry.dispose();
          const indices=result.indices[entry.section];
          entry.mesh.visible=entry.visible&&indices.length>0;
          if(!indices.length){entry.mesh.geometry=entry.source;continue;}
          // Layer passes get their own compacted copy: their UV channel differs from the base mesh.
          entry.mesh.geometry=compact(entry.source,indices);
        }
        finish(result);
      };
      worker.onerror=()=>{worker.terminate();this.worker=undefined;changed('Simplification worker failed');};
      const copies=this.sections.map(s=>({index:s.index.slice(),attributes:s.attributes}));
      worker.postMessage({sections:copies,options:{ratio:settings.ratio,mode:settings.mode}},copies.map(s=>s.index.buffer));
    },120);
  }
  private setTextureLevels(levels:number){
    this.levels=levels;
    const keep=new Set<string>();
    for(const [material,slots] of this.originals){
      let dirty=false;
      for(const [slot,original] of Object.entries(slots) as [TextureSlot,Texture|null][]){
        let next=original;
        if(original&&levels>0){
          const key=`${original.uuid}:${levels}`;keep.add(key);
          if(!this.reduced.has(key))this.reduced.set(key,reduceTexture(original,levels));
          next=this.reduced.get(key)??original;
        }
        if(material[slot]!==next){material[slot]=next;dirty=true;}
      }
      if(dirty)material.needsUpdate=true;
    }
    for(const [key,texture] of this.reduced)if(!keep.has(key)){texture?.dispose();this.reduced.delete(key);}
  }
  private restoreGeometry(){for(const entry of this.entries){if(entry.mesh.geometry!==entry.source)entry.mesh.geometry.dispose();entry.mesh.geometry=entry.source;entry.mesh.visible=entry.visible;}}
  dispose(){this.disposed=true;this.revision++;clearTimeout(this.timer);this.worker?.terminate();this.restoreGeometry();this.setTextureLevels(0);}
}

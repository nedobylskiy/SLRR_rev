import {BufferAttribute,BufferGeometry,type Mesh} from 'three';
import {LOD_LEVELS,LOD_MAX_ERROR,LOD_RATIOS} from './lod-distance';
import type {LodSection} from './lod-simplify';
import type {LodJobRequest,LodJobResponse} from './lod-job';

/** Per level 1..LOD_LEVELS: indices into the topology geometry's vertices; equal arrays mean an identical level. */
type Levels=(Uint32Array|undefined)[];
interface Topology {state:'queued'|'busy'|'ready'|'skipped';levels?:Levels}
interface Job {id:number;geometries:BufferGeometry[];priority:number}

/** Geometry a mesh shows at full detail, whichever generated level is installed. */
export function fullGeometry(mesh:Mesh):BufferGeometry {return (mesh.geometry.userData.lodFull as BufferGeometry|undefined)??mesh.geometry;}

/** Generated views never own vertex data, so only their index and binding state may be freed. */
function release(view:BufferGeometry){view.attributes={};view.index=null;view.dispose();}

function sectionOf(geometry:BufferGeometry):LodSection {
  const attributes:LodSection['attributes']={};
  for(const [name,attribute] of Object.entries(geometry.attributes)){
    const size=attribute.count*attribute.itemSize;let array:Float32Array;
    // Runs on the main thread while driving into new streets: copy plain arrays wholesale.
    if(attribute instanceof BufferAttribute&&!attribute.normalized&&attribute.array.length===size)array=Float32Array.from(attribute.array as ArrayLike<number>);
    else{
      array=new Float32Array(size);
      // getComponent denormalizes normalized channels and reads interleaved data.
      for(let i=0;i<attribute.count;i++)for(let j=0;j<attribute.itemSize;j++)array[i*attribute.itemSize+j]=attribute.getComponent(i,j);
    }
    attributes[name]={array,itemSize:attribute.itemSize};
  }
  const index=geometry.index?Uint32Array.from(geometry.index.array as ArrayLike<number>):Uint32Array.from({length:geometry.getAttribute('position').count},(_,i)=>i);
  return {index,attributes};
}

/**
 * Background meshoptimizer LOD chains shared by every user of a geometry. A level is an index buffer into the
 * source vertices, so a view reuses the live vertex buffers: dents and paint written to them show at every level.
 */
export class LodLibrary {
  private topologies=new WeakMap<BufferGeometry,Topology>();
  private views=new WeakMap<BufferGeometry,{key:string;views:Map<Uint32Array,BufferGeometry>}>();
  /** One GPU index buffer per level, shared by every copy (dented traffic, panel skins) that draws it. */
  private indexAttributes=new WeakMap<Uint32Array,BufferAttribute>();
  private queue:Job[]=[];
  private workers:{worker:Worker;job?:Job}[]=[];
  private next=0;
  private unavailable=false;
  private ready=0;
  private skipped=0;
  private listeners=new Set<()=>void>();
  constructor(private poolSize=Math.max(1,Math.min(2,(globalThis.navigator?.hardwareConcurrency??2)-2))){}
  /** Called whenever generated levels become available or generation stops. */
  onChange(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private changed(){for(const listener of this.listeners)listener();}
  get info(){return `LOD chains: ${this.unavailable?'worker unavailable':`${this.ready} ready · ${this.queue.length+this.workers.filter(w=>w.job).length} jobs queued · ${this.skipped} kept original`}`;}

  /** Small, grouped, morphed or partially drawn geometry keeps its original. */
  static eligible(geometry:BufferGeometry){
    const position=geometry.getAttribute('position');
    return !!position&&position.itemSize===3&&!geometry.groups.length&&!Object.keys(geometry.morphAttributes).length
      &&geometry.drawRange.start===0&&geometry.drawRange.count===Infinity&&!geometry.userData.lodFull;
  }
  /**
   * Queue one model whose sections share a single error threshold, so its small parts collapse first.
   * Lower priority runs first. Already known geometries are left alone.
   */
  /** Smaller models still drop shells and flat detail within the error cap; below this nothing is worth a job. */
  static minTriangles=32;
  request(geometries:BufferGeometry[],priority=0){
    if(this.unavailable||typeof Worker==='undefined'){this.unavailable=true;return;}
    const fresh=[...new Set(geometries)].filter(g=>!this.topologies.has(g)&&LodLibrary.eligible(g));
    if(!fresh.length)return;
    const triangles=fresh.reduce((n,g)=>n+(g.index?.count??g.getAttribute('position').count)/3,0);
    if(triangles<LodLibrary.minTriangles){for(const g of fresh)this.topologies.set(g,{state:'skipped'});this.skipped+=fresh.length;return;}
    for(const g of fresh){
      this.topologies.set(g,{state:'queued'});
      const forget=()=>{g.removeEventListener('dispose',forget);this.topologies.delete(g);};g.addEventListener('dispose',forget);
    }
    this.queue.push({id:++this.next,geometries:fresh,priority});this.pump();
  }
  /** Raise a queued model's priority when it comes closer. */
  prioritize(geometry:BufferGeometry,priority:number){const job=this.queue.find(j=>j.geometries.includes(geometry));if(job)job.priority=Math.min(job.priority,priority);}
  has(geometry:BufferGeometry){return this.topologies.has(geometry);}
  /** Index for a level (1..LOD_LEVELS), or undefined while not generated, skipped, or for level 0. */
  indices(topology:BufferGeometry,level:number):Uint32Array|undefined {
    return level>0?this.topologies.get(topology)?.levels?.[Math.min(level,LOD_LEVELS)-1]:undefined;
  }
  /**
   * The geometry to draw for `current` (the mesh's full-detail geometry) at a level. `topology` is the geometry
   * whose triangles were simplified: itself, or for a layer pass and dented copies, the source they were cloned from.
   */
  view(current:BufferGeometry,topology:BufferGeometry,level:number):BufferGeometry {
    const index=this.indices(topology,level);
    if(!index||current.getAttribute('position')?.count!==topology.getAttribute('position')?.count)return current;
    const key=Object.entries(current.attributes).map(([n,a])=>`${n}:${'id' in a?a.id:a.data.uuid}`).join('|');
    let cache=this.views.get(current);
    if(cache&&cache.key!==key){for(const view of cache.views.values())release(view);cache=undefined;}
    if(!cache){
      cache={key,views:new Map()};this.views.set(current,cache);
      const entry=cache,dispose=()=>{current.removeEventListener('dispose',dispose);for(const view of entry.views.values())release(view);entry.views.clear();this.views.delete(current);};
      current.addEventListener('dispose',dispose);
    }
    let view=cache.views.get(index);
    if(!view){
      view=new BufferGeometry();view.name=`${current.name} / LOD`;
      for(const [name,attribute] of Object.entries(current.attributes))view.setAttribute(name,attribute);
      let shared=this.indexAttributes.get(index);if(!shared)this.indexAttributes.set(index,shared=new BufferAttribute(index,1));
      view.setIndex(shared);
      // Shared objects: owners recompute these in place after dents.
      view.boundingBox=current.boundingBox;view.boundingSphere=current.boundingSphere;
      if(!view.boundingSphere){current.computeBoundingSphere();view.boundingSphere=current.boundingSphere;}
      view.userData={lodFull:current};
      cache.views.set(index,view);
    }
    return view;
  }

  private pump(){
    while(this.workers.length<this.poolSize&&this.workers.filter(w=>!w.job).length<this.queue.length)this.workers.push(this.spawn());
    this.queue.sort((a,b)=>a.priority-b.priority);
    for(const slot of this.workers){
      if(slot.job)continue;
      let job:Job|undefined;
      // Disposed geometries forget their entries; skip jobs nobody is waiting for.
      while((job=this.queue.shift())&&job.geometries.some(g=>!this.topologies.has(g))){}
      if(!job)return;
      slot.job=job;for(const g of job.geometries)this.topologies.get(g)!.state='busy';
      const request:LodJobRequest={id:job.id,sections:job.geometries.map(sectionOf),ratios:[...LOD_RATIOS],options:{mode:'quality',maxError:[...LOD_MAX_ERROR]}};
      slot.worker.postMessage(request,request.sections.flatMap(s=>[s.index.buffer as ArrayBuffer,...Object.values(s.attributes).map(a=>a.array.buffer as ArrayBuffer)]));
    }
  }
  private spawn(){
    const slot:{worker:Worker;job?:Job}={worker:new Worker(new URL('./lod-worker.ts',import.meta.url),{type:'module'})};
    slot.worker.onmessage=(event:MessageEvent<LodJobResponse>)=>{
      const job=slot.job;slot.job=undefined;
      if(job&&event.data.id===job.id)this.finish(job,event.data);
      this.pump();
    };
    slot.worker.onerror=()=>{
      for(const w of this.workers)w.worker.terminate();
      for(const job of [...this.queue,...this.workers.flatMap(w=>w.job?[w.job]:[])])for(const g of job.geometries)this.topologies.set(g,{state:'skipped'});
      this.workers=[];this.queue=[];this.unavailable=true;this.changed();
    };
    return slot;
  }
  private finish(job:Job,response:LodJobResponse){
    const packed=response.levels;
    job.geometries.forEach((geometry,s)=>{
      const topology=this.topologies.get(geometry);if(!topology)return;
      if(!packed?.length){topology.state='skipped';this.skipped++;return;}
      const levels:Levels=[],full=geometry.index?.count??geometry.getAttribute('position').count;
      for(const entry of packed){
        // Reused levels keep the same array instance so views and draws collapse together.
        const index=typeof entry==='number'?levels[entry]:entry[s];
        const previous=levels.at(-1);
        // A level that kept every triangle draws the original geometry instead.
        levels.push(!index||index.length>=full?undefined:previous&&previous.length===index.length&&previous.every((v,i)=>v===index[i])?previous:index);
      }
      topology.levels=levels;topology.state='ready';this.ready++;
    });
    this.changed();
  }
  dispose(){for(const w of this.workers)w.worker.terminate();this.workers=[];this.queue=[];}
}

import {BufferAttribute,BufferGeometry} from 'three';
import type {LodGeometryData} from './map-lod-generator';

/** Lazy single-worker generation. Full detail stays installed until a valid LOD is ready. */
export class MapAutoLod {
  private worker?:Worker;
  private unavailable=false;
  private rejected=new WeakSet<BufferGeometry>();
  private skipped=0;
  private next=0;
  private entries=new Map<BufferGeometry,{id:number;geometry?:BufferGeometry;release:()=>void}>();
  private queue:BufferGeometry[]=[];
  private busy?:{id:number;source:BufferGeometry};
  constructor(private changed:()=>void){}
  get info(){return `LOD generation: ${this.unavailable?'worker unavailable':`${[...this.entries.values()].filter(e=>e.geometry).length} ready · ${this.queue.length+(this.busy?1:0)} queued · ${this.skipped} kept original`}`;}
  get(source:BufferGeometry):BufferGeometry|undefined {
    const existing=this.entries.get(source);if(existing)return existing.geometry;
    if(typeof Worker==='undefined')this.unavailable=true;
    if(this.unavailable||this.rejected.has(source)||this.queue.length>=64)return;
    const count=source.getAttribute('position')?.count??0;
    if(count<120||count>6000||source.groups.length||Object.keys(source.morphAttributes).length
      ||source.drawRange.start!==0||source.drawRange.count!==Infinity
      ||Object.keys(source.attributes).some(n=>!['position','normal','uv','tangent','slrrColor'].includes(n))){this.rejected.add(source);this.skipped++;return;}
    const release=()=>{this.entries.get(source)?.geometry?.dispose();this.entries.delete(source);source.removeEventListener('dispose',release);};
    this.entries.set(source,{id:++this.next,release});source.addEventListener('dispose',release);
    this.queue.push(source);this.pump();
  }
  private pump(){
    if(this.busy||this.unavailable)return;
    let source:BufferGeometry|undefined;
    while((source=this.queue.shift())&&!this.entries.has(source)){}
    if(!source)return;
    try {
      if(!this.worker){
        this.worker=new Worker(new URL('./map-lod-worker.ts',import.meta.url),{type:'module'});
        this.worker.onmessage=(event:MessageEvent<{id:number;data?:LodGeometryData}>)=>{
          const job=this.busy;if(!job||event.data.id!==job.id)return;
          const entry=this.entries.get(job.source);
          if(entry?.id===job.id&&event.data.data){
            const geometry=new BufferGeometry(),data=event.data.data;
            for(const [name,a] of Object.entries(data.attributes))geometry.setAttribute(name,new BufferAttribute(a.array,a.itemSize));
            if(data.index)geometry.setIndex(new BufferAttribute(data.index,1));
            geometry.computeBoundingBox();geometry.computeBoundingSphere();entry.geometry=geometry;
          }
          if(entry&&!event.data.data)this.skipped++;
          this.busy=undefined;this.changed();this.pump();
        };
        this.worker.onerror=()=>{this.unavailable=true;this.worker?.terminate();this.busy=undefined;this.queue=[];this.changed();};
      }
      const attributes:LodGeometryData['attributes']={};
      for(const [name,a] of Object.entries(source.attributes)){
        const array=new Float32Array(a.count*a.itemSize);
        for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)array[i*a.itemSize+j]=a.getComponent(i,j);
        attributes[name]={array,itemSize:a.itemSize};
      }
      const entry=this.entries.get(source)!;this.busy={id:entry.id,source};
      this.worker.postMessage({id:entry.id,data:{attributes,index:source.index?new Uint32Array(source.index.array):undefined}});
    } catch {this.unavailable=true;this.worker?.terminate();this.busy=undefined;this.queue=[];}
  }
  dispose(){this.worker?.terminate();this.worker=undefined;for(const e of [...this.entries.values()])e.release();this.queue=[];this.busy=undefined;}
}

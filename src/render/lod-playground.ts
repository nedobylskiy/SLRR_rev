import {BufferGeometry,BufferGeometryLoader,Mesh,type Object3D,type Material} from 'three';

export class LodPlayground {
  private entries:{mesh:Mesh;source:BufferGeometry}[]=[];
  private worker?:Worker;
  private timer?:ReturnType<typeof setTimeout>;
  private revision=0;
  private disposed=false;
  constructor(root:Object3D){root.traverse(object=>{if(object instanceof Mesh)this.entries.push({mesh:object,source:object.geometry});});}
  private triangles(geometry:BufferGeometry){return (geometry.index?.count??geometry.getAttribute('position')?.count??0)/3;}
  info(){const before=this.entries.reduce((n,e)=>n+this.triangles(e.source),0),after=this.entries.reduce((n,e)=>n+this.triangles(e.mesh.geometry),0);return `${Math.round(before).toLocaleString('en-US')} → ${Math.round(after).toLocaleString('en-US')} triangles · ${before?Math.round(after/before*100):100}% remaining`;}
  wireframe(enabled:boolean){for(const {mesh} of this.entries)for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]) as (Material&{wireframe?:boolean})[])material.wireframe=enabled;}
  setRatio(ratio:number,changed:(message:string)=>void){
    if(this.disposed)return;
    const revision=++this.revision;clearTimeout(this.timer);this.worker?.terminate();this.worker=undefined;
    if(ratio>=1){this.restore();changed(this.info());return;}
    changed(`${this.info()} · simplifying…`);
    this.timer=setTimeout(()=>{
      if(this.disposed||revision!==this.revision)return;
      const worker=this.worker=new Worker(new URL('./lod-playground-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=(event:MessageEvent<{geometries?:ReturnType<BufferGeometry['toJSON']>[];error?:string;kept:number}>)=>{
        if(this.disposed||revision!==this.revision)return;
        worker.terminate();this.worker=undefined;
        if(event.data.error){changed(`Simplification failed: ${event.data.error}`);return;}
        const loader=new BufferGeometryLoader();
        event.data.geometries?.forEach((json,i)=>{const entry=this.entries[i];if(entry.mesh.geometry!==entry.source)entry.mesh.geometry.dispose();entry.mesh.geometry=loader.parse(json);});
        changed(`${this.info()}${event.data.kept?` · ${event.data.kept} sections kept original (unsupported attributes)` : ''}`);
      };
      worker.onerror=()=>{worker.terminate();this.worker=undefined;changed('Simplification worker failed');};
      worker.postMessage({ratio,geometries:this.entries.map(e=>e.source.toJSON())});
    },120);
  }
  private restore(){for(const entry of this.entries){if(entry.mesh.geometry!==entry.source)entry.mesh.geometry.dispose();entry.mesh.geometry=entry.source;}}
  dispose(){this.disposed=true;this.revision++;clearTimeout(this.timer);this.worker?.terminate();this.restore();}
}

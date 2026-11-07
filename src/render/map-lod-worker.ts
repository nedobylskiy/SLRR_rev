import { generateMapLod,type LodGeometryData } from './map-lod-generator';
self.onmessage=(event:MessageEvent<{id:number;data:LodGeometryData}>)=>{
  try {self.postMessage({id:event.data.id,data:generateMapLod(event.data.data)});}
  catch {self.postMessage({id:event.data.id});}
};

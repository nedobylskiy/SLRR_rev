import {simplifyLod,type LodOptions,type LodSection} from './lod-simplify';

self.onmessage=async(event:MessageEvent<{sections:LodSection[];options:LodOptions}>)=>{
  try{
    const result=await simplifyLod(event.data.sections,event.data.options);
    self.postMessage({result},{transfer:result.indices.map(index=>index.buffer as ArrayBuffer)});
  }catch(error){self.postMessage({error:String(error)});}
};

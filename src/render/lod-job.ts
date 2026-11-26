import {simplifyLevels,type LodLevelOptions,type LodSection} from './lod-simplify';

export interface LodJobRequest {id:number;sections:LodSection[];ratios:number[];options:LodLevelOptions}
/** levels[k][s]: indices of section s at level k, or the index of an earlier level that is reused unchanged. */
export interface LodJobResponse {id:number;levels?:(Uint32Array[]|number)[];error?:string}

export async function runLodJob({id,sections,ratios,options}:LodJobRequest):Promise<{response:LodJobResponse;transfer:ArrayBuffer[]}> {
  try {
    const levels=await simplifyLevels(sections,ratios,options);
    const packed:(Uint32Array[]|number)[]=[],transfer=new Set<ArrayBuffer>();
    levels.forEach((level,k)=>{
      const earlier=levels.indexOf(level);
      if(earlier<k){packed.push(earlier);return;}
      // Untouched sections alias the source index, which the caller already has.
      packed.push(level.indices.map((index,s)=>{
        const copy=index===sections[s].index?index.slice():index;transfer.add(copy.buffer as ArrayBuffer);return copy;
      }));
    });
    return {response:{id,levels:packed},transfer:[...transfer]};
  } catch(error){return {response:{id,error:String(error)},transfer:[]};}
}

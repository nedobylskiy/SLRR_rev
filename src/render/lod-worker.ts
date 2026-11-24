import {runLodJob,type LodJobRequest} from './lod-job';

self.onmessage=async(event:MessageEvent<LodJobRequest>)=>{
  const {response,transfer}=await runLodJob(event.data);
  self.postMessage(response,{transfer});
};

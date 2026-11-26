// Exercise the production runtime on an actual separate thread in asset checks.
import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {register} from 'tsx/esm/api';
register();
const {softBodyRuntime}=await import('../src/engine/soft-body-wasm.ts');
if(!await softBodyRuntime.load(()=>readFile(new URL('../src/engine/wasm/soft-body.wasm',import.meta.url))))throw Error(softBodyRuntime.error);
const {VehiclePhysicsWorkerRuntime}=await import('../src/workers/vehicle-physics-worker.ts');
const runtime=new VehiclePhysicsWorkerRuntime();
parentPort.on('message',request=>{
  try{const response=runtime.handle(request);if(response)parentPort.postMessage(response);}
  catch(error){parentPort.postMessage({error:error.stack??String(error)});}
});

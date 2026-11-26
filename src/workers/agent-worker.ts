import {AgentSimulation} from '../engine/agent-simulation';
import type {AgentRequest} from '../engine/agent-worker-protocol';
const simulation=new AgentSimulation();
const scope=self as unknown as {onmessage:(event:MessageEvent<{id:number;request:AgentRequest}>)=>void;postMessage:(message:unknown)=>void};
scope.onmessage=event=>{const {id,request}=event.data;try{const start=performance.now(),result=simulation.update(request);if(result)scope.postMessage({id,result,workMs:performance.now()-start});}catch(error){scope.postMessage({id,error:String(error)});}};

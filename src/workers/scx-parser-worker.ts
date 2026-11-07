import {parseScxRequest,scxModelTransfers,type ScxParseRequest,type ScxParseReply} from '../formats/scx-worker-protocol';

const scope=self as unknown as {onmessage:(event:MessageEvent<ScxParseRequest>)=>void;postMessage:(reply:ScxParseReply,transfer:Transferable[])=>void};
scope.onmessage=event=>{
  const reply=parseScxRequest(event.data);
  scope.postMessage(reply,'model' in reply?scxModelTransfers(reply.model):[]);
};

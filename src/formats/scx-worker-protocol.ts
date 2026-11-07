import {parseScx,type ScxModel} from './scx';

export interface ScxParseRequest {id:number;bytes:Uint8Array}
export type ScxParseReply={id:number;model:ScxModel}|{id:number;error:string};

/** Parser output consists only of cloneable metadata and owned typed-array buffers. */
export function scxModelTransfers(model:ScxModel):ArrayBuffer[]{
  const buffers=new Set<ArrayBuffer>();
  for(const mesh of model.meshes)for(const value of Object.values(mesh))
    if(ArrayBuffer.isView(value)&&value.buffer instanceof ArrayBuffer)buffers.add(value.buffer);
  return [...buffers];
}
export function parseScxRequest(request:ScxParseRequest):ScxParseReply{
  try{return {id:request.id,model:parseScx(request.bytes)};}
  catch(error){return {id:request.id,error:error instanceof Error?error.message:String(error)};}
}

import {normalizePath,type Assets} from '../assets';

/** Short-lived reads for one model assembly. Compiled ground has thousands of
 * material sections sharing a small texture table; do not fetch each file for
 * every section. The batch is discarded when assembly finishes. */
export function assetReadBatch(assets:Assets){
  const reads=new Map<string,Promise<Uint8Array>>();
  return (path:string)=>{
    const key=normalizePath(path);let pending=reads.get(key);
    if(!pending){
      pending=assets.read(path);reads.set(key,pending);
      const created=pending;
      void pending.catch(()=>{if(reads.get(key)===created)reads.delete(key);});
    }
    return pending;
  };
}

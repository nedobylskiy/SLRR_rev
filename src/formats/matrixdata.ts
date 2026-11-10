/** Original per-bone animation blocks: count, timed quaternion/direction keys, then names. */
export interface MatrixAnimationBone { name:string; rotations:Float32Array; directions:Float32Array }
export interface MatrixAnimation { times:Float32Array; bones:MatrixAnimationBone[] }
export function parseMatrixData(bytes:Uint8Array):MatrixAnimation {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  const word=()=>{if(at+4>bytes.length)throw Error('Truncated matrixdata');const n=view.getUint32(at,true);at+=4;return n;};
  const count=word();if(count<1||count>4096)throw Error('Invalid matrixdata bone count');
  const bones:MatrixAnimationBone[]=[];let times=new Float32Array(0),keys=0;
  for(let b=0;b<count;b++){
    const declared=word();if(b===0){keys=declared;if(keys<1||keys*32*count>bytes.length)throw Error('Invalid matrixdata key count');times=new Float32Array(keys);}
    else if(declared!==keys)throw Error('Inconsistent matrixdata key counts');
    if(at+keys*32>bytes.length)throw Error('Truncated matrixdata keys');
    const rotations=new Float32Array(keys*4),directions=new Float32Array(keys*3);
    for(let k=0;k<keys;k++){
      const values=Array.from({length:8},(_,j)=>view.getFloat32(at+j*4,true));at+=32;
      if(values.some(v=>!Number.isFinite(v)))throw Error('Non-finite matrixdata key');
      if(b===0){times[k]=values[0];if(times[k]<0||(k>0&&times[k]<=times[k-1]))throw Error('Invalid matrixdata key times');}
      else if(Math.abs(times[k]-values[0])>1e-5)throw Error('Inconsistent matrixdata key times');
      const norm=Math.hypot(...values.slice(1,5));if(Math.abs(norm-1)>.01)throw Error('Invalid matrixdata quaternion');
      rotations.set(values.slice(1,5),k*4);directions.set(values.slice(5),k*3);
    }
    bones.push({name:'',rotations,directions});
  }
  const names=new TextDecoder('windows-1252').decode(bytes.subarray(at)).replace(/\r/g,'').split('\n');
  if(names.at(-1)==='')names.pop();
  if(names.length!==count||names.some(n=>!n.trim())||new Set(names).size!==count)throw Error('Invalid matrixdata bone names');
  bones.forEach((bone,i)=>bone.name=names[i]);return {times,bones};
}

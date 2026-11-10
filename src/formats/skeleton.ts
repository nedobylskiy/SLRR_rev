export interface SkeletonBone {name:string;parent:number;rotation:number[];position:number[];limits:[number,number][]}
/** BON/SKL use the same nine-line record. Transforms remain in source units. */
export function parseSkeleton(text:string):SkeletonBone[]{
  const lines=text.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/).map(line=>line.trim());
  if(lines.length%9||!lines.length||lines.length>9*4096)throw Error('Skeleton: incomplete bone records');
  const names=new Set<string>(),bones:SkeletonBone[]=[];
  const numbers=(line:string,count:number)=>{const values=line.split(',').map(v=>Number(v.trim()));if(values.length!==count||values.some(n=>!Number.isFinite(n))||line.split(',').some(v=>!v.trim()))throw Error('Skeleton: invalid numeric row');return values;};
  for(let i=0;i<lines.length;i+=9){
    const name=lines[i],parent=Number(lines[i+1]);
    if(!name||names.has(name)||!lines[i+1]||!Number.isInteger(parent)||parent< -1)throw Error('Skeleton: invalid bone name or parent');names.add(name);
    bones.push({name,parent,rotation:[2,3,4].flatMap(row=>numbers(lines[i+row],3)),position:numbers(lines[i+5],3),limits:[6,7,8].map(row=>numbers(lines[i+row],2) as [number,number])});
  }
  const state=new Uint8Array(bones.length);
  const visit=(i:number)=>{if(state[i]===1)throw Error('Skeleton: cyclic hierarchy');if(state[i]===2)return;state[i]=1;const parent=bones[i].parent;if(parent>=bones.length)throw Error('Skeleton: parent outside bone table');if(parent>=0)visit(parent);state[i]=2;};
  bones.forEach((_,i)=>visit(i));return bones;
}

import {MeshoptSimplifier} from 'meshoptimizer/simplifier';

/** One material section. Attribute arrays are denormalized floats, `itemSize` values per vertex. */
export interface LodSection {
  index:Uint32Array;
  attributes:Record<string,{array:Float32Array;itemSize:number}>;
}
export type LodMode='quality'|'aggressive';
export interface LodOptions {ratio:number;mode:LodMode}
export interface LodResult {
  /** Per section, indices into the section's original vertices. Empty means the section is dropped. */
  indices:Uint32Array[];
  sourceTriangles:number;
  triangles:number;
  /** Shared geometric error threshold as a fraction of the model's bounding diagonal. */
  error:number;
  /** Quality mode could not meet the budget with every seam held and collapsed across seams instead. */
  relaxedSeams:boolean;
}

/** Attributes that steer collapse cost; every other channel is carried unchanged because vertices are never moved. */
const weighted:Record<string,number>={normal:.5,uv:1,slrrColor:.5};

interface Prepared {index:Uint32Array;positions:Float32Array;attributes:Float32Array;stride:number;weights:number[];scale:number}

/** Vertices identical in every channel become one, so meshopt sees real topology instead of a triangle soup. */
function weld(section:LodSection):Uint32Array {
  const channels=Object.values(section.attributes),count=section.attributes.position.array.length/3;
  const first=new Map<string,number>(),canonical=new Uint32Array(count),parts:number[]=[];
  for(let v=0;v<count;v++){
    parts.length=0;
    for(const {array,itemSize} of channels)for(let j=0;j<itemSize;j++)parts.push(array[v*itemSize+j]);
    const key=parts.join(','),existing=first.get(key);
    if(existing===undefined){first.set(key,v);canonical[v]=v;}else canonical[v]=existing;
  }
  return section.index.map(i=>canonical[i]);
}

function prepare(section:LodSection):Prepared|undefined {
  const position=section.attributes.position;
  if(!position||position.itemSize!==3||section.index.length<3)return;
  const count=position.array.length/3,names=Object.keys(weighted).filter(name=>section.attributes[name]);
  const stride=names.reduce((n,name)=>n+section.attributes[name].itemSize,0),attributes=new Float32Array(Math.max(1,count*stride));
  const weights:number[]=[];
  let offset=0;
  for(const name of names){
    const {array,itemSize}=section.attributes[name];
    for(let v=0;v<count;v++)for(let j=0;j<itemSize;j++)attributes[v*stride+offset+j]=array[v*itemSize+j];
    for(let j=0;j<itemSize;j++)weights.push(weighted[name]);
    offset+=itemSize;
  }
  const scale=MeshoptSimplifier.getScale(position.array,3);
  return {index:weld(section),positions:position.array,attributes,stride,weights,scale};
}

type Pass='strict'|'permissive'|'sloppy';
function reduce(section:Prepared,absoluteError:number,pass:Pass):Uint32Array {
  if(!section.scale)return section.index;
  const relative=absoluteError/section.scale;
  if(pass==='sloppy')return MeshoptSimplifier.simplifySloppy(section.index,section.positions,3,null,0,relative)[0];
  const flags:('Prune'|'Permissive')[]=pass==='permissive'?['Prune','Permissive']:['Prune'];
  if(!section.stride)return MeshoptSimplifier.simplify(section.index,section.positions,3,0,relative,flags)[0];
  return MeshoptSimplifier.simplifyWithAttributes(section.index,section.positions,3,section.attributes,section.stride,
    section.weights,null,0,relative,flags)[0];
}

function diagonal(sections:LodSection[]){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const section of sections){
    const p=section.attributes.position?.array;if(!p)continue;
    for(let i=0;i<p.length;i++){const axis=i%3;if(p[i]<min[axis])min[axis]=p[i];if(p[i]>max[axis])max[axis]=p[i];}
  }
  return min[0]<=max[0]?Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2]):0;
}

interface Candidate {indices:Uint32Array[];triangles:number;error:number}
interface Model {sections:LodSection[];prepared:(Prepared|undefined)[];size:number;sourceTriangles:number}
interface Bounds {low:number;high:number;tolerance:number}

function search(model:Model,pass:Pass,target:number,{low,high,tolerance}:Bounds):Candidate {
  const miss=(triangles:number)=>Math.abs(Math.log(Math.max(triangles,.5)/target));
  const run=(error:number):Candidate=>{
    const indices=model.prepared.map((section,i)=>section?reduce(section,error,pass):model.sections[i].index);
    return {indices,triangles:indices.reduce((n,index)=>n+index.length/3,0),error};
  };
  // Triangles fall as error grows, but Prune drops whole shells in steps, so keep the closest
  // candidate from either side instead of insisting on staying under budget.
  let lower=Math.log(low),upper=Math.log(high),best=run(low);
  for(let step=0;step<20&&miss(best.triangles)>tolerance;step++){
    const middle=(lower+upper)/2,candidate=run(Math.exp(middle));
    if(miss(candidate.triangles)<miss(best.triangles)||miss(candidate.triangles)===miss(best.triangles)&&candidate.triangles<best.triangles)best=candidate;
    if(candidate.triangles>target)lower=middle;else upper=middle;
  }
  return best;
}

/** Strict seams first; open car shells floor near half their triangles with every UV/normal seam held. */
function pick(model:Model,ratio:number,mode:LodMode,strict:Bounds,permissive:Bounds){
  const target=Math.max(1,Math.round(model.sourceTriangles*Math.max(0,ratio)));
  const miss=(triangles:number)=>Math.abs(Math.log(Math.max(triangles,.5)/target)),fits=(t:number)=>miss(t)<.15;
  const best=search(model,mode==='aggressive'?'sloppy':'strict',target,strict);
  // Below the floor the strict pass meets the budget only by pruning whole sections. Relax seams when that is clearly better.
  if(mode==='quality'&&best.error>model.size*.005){
    const relaxed=search(model,'permissive',target,permissive);
    if(fits(relaxed.triangles)&&(!fits(best.triangles)||relaxed.error<best.error*.7))return {...relaxed,relaxedSeams:true};
  }
  return {...best,relaxedSeams:false};
}

function build(sections:LodSection[]):Model {
  return {sections,prepared:sections.map(prepare),size:diagonal(sections),sourceTriangles:sections.reduce((n,s)=>n+Math.floor(s.index.length/3),0)};
}

/**
 * One absolute error threshold for the whole model, searched so the total triangle count meets the ratio.
 * Small parts collapse or disappear before large surfaces lose their silhouette, unlike a per-section quota.
 */
export async function simplifyLod(sections:LodSection[],options:LodOptions):Promise<LodResult> {
  if(!Number.isFinite(options.ratio))throw Error('Invalid detail ratio');
  await MeshoptSimplifier.ready;
  const model=build(sections),{sourceTriangles,size}=model;
  if(options.ratio>=1||!sourceTriangles||!size)return {indices:sections.map(s=>s.index),sourceTriangles,triangles:sourceTriangles,error:0,relaxedSeams:false};
  const bounds={low:size*1e-6,high:size,tolerance:.03};
  const best=pick(model,options.ratio,options.mode,bounds,bounds);
  return {indices:best.indices,sourceTriangles,triangles:best.triangles,error:best.error/size,relaxedSeams:best.relaxedSeams};
}

export interface LodLevel {
  /** Per section; the same array instance as the previous level when this level brought no real saving. */
  indices:Uint32Array[];
  triangles:number;
  error:number;
  relaxedSeams:boolean;
}
export interface LodLevelOptions {
  mode:LodMode;
  /**
   * Error ceiling as a fraction of the model diagonal, one value for all levels or one per ratio; a level keeps
   * more triangles rather than exceed it. Wide ceilings also allow a sloppy pass for low-poly or open models.
   */
  maxError:number|readonly number[];
}

/**
 * Descending ratios share one preparation. Each level's search starts at the previous level's error, which is
 * monotonic per pass, so a full chain costs little more than its deepest level.
 */
export async function simplifyLevels(sections:LodSection[],ratios:readonly number[],options:LodLevelOptions):Promise<LodLevel[]> {
  await MeshoptSimplifier.ready;
  const model=build(sections),{size,sourceTriangles}=model;
  if(!sourceTriangles||!size)return [];
  const cap=(k:number)=>size*Math.min(1,Math.max(1e-5,typeof options.maxError==='number'?options.maxError:options.maxError[Math.min(k,options.maxError.length-1)]));
  const strict={low:Math.min(size*1e-6,cap(0)),high:cap(0),tolerance:.05},permissive={...strict};
  const levels:LodLevel[]=[];
  let previous:LodLevel={indices:sections.map(s=>s.index),triangles:sourceTriangles,error:0,relaxedSeams:false};
  for(const [k,ratio] of ratios.entries()){
    if(!(ratio>0&&ratio<1))throw Error('LOD ratios must lie in (0, 1)');
    const high=cap(k);strict.high=permissive.high=Math.max(high,strict.low,permissive.low);
    let best:Candidate&{relaxedSeams:boolean;sloppy?:boolean}=pick(model,ratio,options.mode,strict,permissive);
    const target=Math.max(1,Math.round(sourceTriangles*ratio)),miss=(t:number)=>Math.abs(Math.log(Math.max(t,.5)/target));
    if(miss(best.triangles)>.15&&high>=size*.05){
      // Leaf cards and thin open shells are all border: edge collapses stall, so far levels fall back to clustering.
      const sloppy=search(model,'sloppy',target,{low:size*1e-4,high,tolerance:.05});
      if(miss(sloppy.triangles)<miss(best.triangles))best={...sloppy,relaxedSeams:true,sloppy:true};
    }
    // Clustering error is on another scale; only edge-collapse passes seed the next level's search.
    if(!best.sloppy&&best.error<=high)(best.relaxedSeams?permissive:strict).low=Math.max(best.relaxedSeams?permissive.low:strict.low,best.error);
    // A level that saves under 5% costs a draw/upload without a visible benefit.
    const level=best.triangles<previous.triangles*.95?{indices:best.indices,triangles:best.triangles,error:best.error/size,relaxedSeams:best.relaxedSeams}:previous;
    levels.push(level);previous=level;
  }
  return levels;
}

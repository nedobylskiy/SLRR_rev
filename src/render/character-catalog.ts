import type {Assets} from '../assets';
import {entryProperties} from '../formats/rpk';
import {parseSkeleton,type SkeletonBone} from '../formats/skeleton';

export interface CharacterResource {id:number;name:string;path:string;family:string;bones:SkeletonBone[]}
export interface CharacterCatalog {models:CharacterResource[];animations:CharacterResource[]}
const cache=new WeakMap<Assets,Promise<CharacterCatalog>>();
export const characterFamily=(path:string)=>path.replaceAll('\\','/').toLowerCase().replace(/\.[^/.]+$/,'').replace(/_(walk|jitter)$/,'');

/** Named hierarchy compatibility only; different bone axes still require retargeting. */
export function skeletonCompatibility(target:SkeletonBone[],source:SkeletonBone[]):string|undefined {
  if(target.length!==source.length)return `Bone count differs (${target.length} / ${source.length})`;
  const sourceByName=new Map(source.map(b=>[b.name,b]));
  for(const bone of target){
    const other=sourceByName.get(bone.name);if(!other)return `Missing bone: ${bone.name}`;
    const parent=bone.parent<0?null:target[bone.parent]?.name;
    const otherParent=other.parent<0?null:source[other.parent]?.name;
    if(parent!==otherParent)return `Different parent: ${bone.name}`;
  }
}

/** Discover render and animation resources from the installed RPK, without a hardcoded character list. */
export function loadCharacterCatalog(assets:Assets):Promise<CharacterCatalog>{
  let result=cache.get(assets);if(result)return result;
  result=(async()=>{
    const pack=await assets.pack('humans.rpk'),models:CharacterResource[]=[],animations:CharacterResource[]=[];
    await Promise.all(pack.entries.map(async entry=>{
      const properties=entryProperties(entry),skeleton=properties.find(p=>p.key==='skeleton')?.value;
      const source=properties.find(p=>p.key==='sourcefile')?.value;
      const animation=source&&/\.matrixdata$/i.test(source)?source:undefined;
      if(!skeleton&&!animation)return;
      const resourcePath=skeleton??animation!;
      const bones=parseSkeleton(new TextDecoder().decode(await assets.read(skeleton??animation!.replace(/\.matrixdata$/i,'.bon'))));
      const resource={id:entry.typeId,name:entry.alias,path:resourcePath,family:characterFamily(resourcePath),bones};
      (skeleton?models:animations).push(resource);
    }));
    const sort=(a:CharacterResource,b:CharacterResource)=>a.name.localeCompare(b.name)||a.id-b.id;
    return {models:models.sort(sort),animations:animations.sort(sort)};
  })();
  cache.set(assets,result);result.catch(()=>cache.delete(assets));return result;
}

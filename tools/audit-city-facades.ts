/** Replays the real map material/geometry preparation without a GPU. Texture
 * decoding is limited to dimensions; array copies are represented by identities.
 * This audits batch composition, not measured GPU time or camera visibility. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import * as THREE from 'three';
import {Assets} from '../src/assets';
import {Viewer} from '../src/render/viewer';
import {SceneLighting} from '../src/render/scene-lighting';
import {MapDistanceCutoff} from '../src/render/map-distance-cutoff';
import {MapBackfaceCulling} from '../src/render/map-backface-culling';
import {StaticMapShadows} from '../src/render/static-map-shadows';
import {buildingLayerKey,isBuildingAlias} from '../src/render/building-material-batch';
import {MapMaterialPool} from '../src/render/map-material-pool';
import {GlobalFacadeBatches,type FacadeSource} from '../src/render/global-facade-batches';
import {mapObjectPlacements,parseIcfg,mapObjectSeed,mapRenderResource,isNightMapRenderResource} from '../src/engine/map-objects';
import {mapRenderIds} from '../src/engine/map';
import {poseMatrix} from '../src/engine/transforms';
import {entryProperties} from '../src/formats/rpk';
import {parseScx} from '../src/formats/scx';
import {gameRoot,walk,relativeGamePath,safeGamePath} from './game-files';
const assets=new Assets((await walk(gameRoot)).map(path=>({path:relativeGamePath(path),size:0})),async path=>new Uint8Array(await readFile(await safeGamePath(path))));
const owner='maps/city.rpk',pack=await assets.pack(owner),maps=[{path:owner,pack}];
for(const dep of pack.dependencies){const path=dep.path.replaceAll('\\','/').toLowerCase();if(!path.startsWith('maps/')||!path.endsWith('.rpk')||maps.some(m=>m.path===path)||!assets.byPath.has(path.replace(/\.rpk$/,'.rdb')))continue;const p=await assets.pack(path);if(mapRenderIds(p).length)maps.push({path,pack:p});}
const batches=new Map<string,{alias:string;pack:string;id:number;placements:FacadeSource['placements']}>();
for(const map of maps){const placements=mapObjectPlacements(new TextDecoder('windows-1252').decode(await assets.read(map.path.replace(/\.rpk$/,'.rdb'))),map.pack),byType=new Map<number,typeof placements>();for(const p of placements){const list=byType.get(p.typeId)??[];list.push(p);byType.set(p.typeId,list);}
 for(const [id,instances]of byType){const r=await assets.resource(map.path,id);if(r.entry.type!==8)continue;const cfg=parseIcfg(r.entry.data);const lod=cfg.renders.filter(r=>r.lod).sort((a,b)=>(b.lod![0]+b.lod![1])-(a.lod![0]+a.lod![1])||b.lod![1]-a.lod![1])[0];
  for(const render of cfg.renders){if(render.lod&&render!==lod)continue;for(const p of instances){const seed=mapObjectSeed(p),rid=mapRenderResource(render,seed);if(!rid)continue;const key=`${r.packPath.toLowerCase()}:${rid}`;let batch=batches.get(key);if(!batch){batch={alias:r.entry.alias,pack:r.packPath,id:rid,placements:[]};batches.set(key,batch);}const matrix=poseMatrix(p.pose);if(render.pose)matrix.multiply(poseMatrix(render.pose));batch.placements.push({matrix,position:new THREE.Vector3().setFromMatrixPosition(matrix),paintColor:render.colors?.length?render.colors[seed%render.colors.length]:undefined});}}
 }
}
const textures=new Map<string,Promise<THREE.Texture>>(),arrays=new Map<string,THREE.Texture>();let arrayBytes=0;
const viewer:any=Object.create(Viewer.prototype);
Object.assign(viewer,{generation:0,lighting:new SceneLighting(),mapDistanceCutoff:new MapDistanceCutoff(),mapBackfaces:new MapBackfaceCulling(),staticMapShadows:new StaticMapShadows(),bakedLightmaps:{value:1},alphaModes:new Map(),unifiedBuildingOutputs:new Map(),renderer:{},vehicleTextures:{},
 mapTextures:{acquire(path:string,load:()=>Promise<THREE.Texture>){let t=textures.get(path);if(!t){t=load();textures.set(path,t);}return t;}},
 async texture(bytes:Uint8Array,path:string){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=1,height=1;if(/\.dds$/i.test(path)){width=v.getUint32(16,true);height=v.getUint32(12,true);}else if(/\.png$/i.test(path)){width=v.getUint32(16);height=v.getUint32(20);}else if(/\.tga$/i.test(path)){width=v.getUint16(12,true);height=v.getUint16(14,true);}else throw Error(`Unsupported audit texture ${path}`);const texture=new THREE.Texture({width,height} as unknown as TexImageSource);texture.flipY=false;texture.name=path;return texture;},
 buildingTextureArrays:{acquire(_renderer:unknown,materials:THREE.MeshStandardMaterial[]){const key=JSON.stringify(materials.map(buildingLayerKey));let texture=arrays.get(key);if(!texture){const w=Math.max(...materials.map(m=>m.map?.image?.width??1)),h=Math.max(...materials.map(m=>m.map?.image?.height??1)),bytes=Math.ceil(w*h*materials.length*4*4/3);if(w>2048||h>2048||w*h*materials.length>16*1024*1024||arrayBytes+bytes>256*1048576)throw Error('Array budget');texture=new THREE.Texture();texture.name=key;arrays.set(key,texture);arrayBytes+=bytes;}return{texture,release(){}};}}});
viewer.mapBackfaces.setEnabled(true);
const sources:FacadeSource[]=[],pool=new MapMaterialPool(),warnings:string[]=[],models:object[]=[];
for(const batch of batches.values()){if(!isBuildingAlias(batch.alias))continue;const r=await assets.resource(batch.pack,batch.id);if(isNightMapRenderResource(r.entry.alias))continue;const model=await assets.modelForResource(batch.pack,batch.id),group=new THREE.Group();warnings.push(...await viewer.append(parseScx(await assets.read(model.path)),assets,model.textures,group,0,true));const parts=group.children.filter((m):m is THREE.Mesh=>m instanceof THREE.Mesh);for(const part of parts){part.geometry.scale(.01,.01,.01);part.name=`map object ${batch.alias}: ${part.name}`;}const outputs:THREE.Mesh[]=viewer.unifyBuildingParts(parts,warnings);pool.acquire(outputs);models.push({alias:batch.alias,resource:`${batch.pack}:0x${batch.id.toString(16)}`,scx:model.path,placements:batch.placements.length});for(const part of outputs){const mesh=new THREE.InstancedMesh(part.geometry,part.material,batch.placements.length);mesh.name=part.name;mesh.renderOrder=part.renderOrder;mesh.castShadow=part.castShadow;mesh.receiveShadow=part.receiveShadow;mesh.userData.staticMapCaster=part.userData.staticMapCaster;mesh.matrixAutoUpdate=false;if(batch.placements.some(p=>p.paintColor!==undefined))mesh.setColorAt(0,new THREE.Color(0xffffff));sources.push({mesh,placements:batch.placements});}}
const global=new GlobalFacadeBatches(new THREE.Group(),sources),report={note:'CPU replay of original assets and real preparation methods; not measured draw calls. Match triangles/copies to live report before attributing numbered batches.',totals:{sourceParts:global.sources.size,copies:global.sourceCopies,batches:global.meshes.length,triangles:global.triangles,buffersMiB:global.geometryBytes/1048576,arrays:arrays.size},models,batches:global.meshes.map((m,i)=>({batch:i,triangles:(m.geometry.index?.count??m.geometry.getAttribute('position').count)/3,bounds:[m.geometry.boundingBox?.min.toArray(),m.geometry.boundingBox?.max.toArray()],sources:m.userData.facadeContributions})),warnings};
const output=process.argv[2]??'docs/reports/city-facade-batches.json';
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,...report.totals,warnings:report.warnings.length}));

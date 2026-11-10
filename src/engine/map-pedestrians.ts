import {normalizePath,type Assets} from '../assets';
import {loadMapRoads} from './map-roads';
import {parsePedestrianRest,parsePedestrianWalk} from '../formats/pedestrian';
export async function loadMapPedestrians(assets:Assets,pack:string,groundId?:number){
  const roads=await loadMapRoads(assets,pack,groundId);
  const prefix=normalizePath(pack).replace(/\.rpk$/,'/ai/');
  const walkPath=roads?.path.replace(/\.trc$/i,'.walk')??[...assets.byPath.keys()].find(p=>p.startsWith(prefix)&&p.endsWith('.walk'));
  const restPath=walkPath?.replace(/\.walk$/i,'.rest');
  if(!walkPath||!assets.byPath.has(normalizePath(walkPath)))return;
  const [walk,rest]=await Promise.all([assets.read(walkPath),restPath&&assets.byPath.has(normalizePath(restPath))?assets.read(restPath):undefined]);
  return {path:walkPath,walk:parsePedestrianWalk(new TextDecoder().decode(walk)),rest:rest?parsePedestrianRest(new TextDecoder().decode(rest)):[]};
}

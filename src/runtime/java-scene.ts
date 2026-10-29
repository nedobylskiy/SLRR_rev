import { jv, type JavaValue } from 'slrr-jvm';
import { normalizeResourcePackPath } from '../assets';
import type { BootResult } from './game-boot';

export interface JavaTrackScene {
  mapPack: string;
  chassis?: { pack: string; id: number };
  start?: { x: number; y: number; z: number; yaw: number };
}

/** Read the active map and car chosen by GameLogic rather than selecting demo assets in the host UI. */
export function activeJavaTrack(result: BootResult): JavaTrackScene | null {
  const { jvm, gameTypes } = result;
  const field = (object: JavaValue | null, name: string): JavaValue | null => {
    if (!object || object.value == null) return null;
    try { return jvm.get(object, name); } catch { return null; }
  };
  const state = field(jv('class', 'java.game.GameLogic'), 'actualState');
  const map = field(state, 'map');
  const mapNode = map?.value == null ? null : gameTypes.getResource(map);
  if (!mapNode?.resourcePack) return null;
  const mapPack = normalizeResourcePackPath(mapNode.resourcePack);
  const player = field(jv('class', 'java.game.GameLogic'), 'player');
  const car = field(player, 'car');
  const chassis = field(car, 'chassis');
  const chassisNode = chassis?.value == null ? null : gameTypes.getResource(chassis);
  const chassisKey = chassisNode?.resourcePack && chassisNode.typeId > 0
    ? { pack: normalizeResourcePackPath(chassisNode.resourcePack), id: chassisNode.typeId } : undefined;
  const position = field(state, 'posStart');
  const orientation = field(state, 'oriStart');
  const x = Number(field(position, 'x')?.value), y = Number(field(position, 'y')?.value);
  const z = Number(field(position, 'z')?.value), yaw = Number(field(orientation, 'y')?.value);
  const start = position?.value != null && [x, y, z, yaw].every(Number.isFinite)
    ? { x, y, z, yaw } : undefined;
  return { mapPack, chassis: chassisKey, start };
}

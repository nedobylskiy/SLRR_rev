import { parseRdb, type RpkPack } from '../formats/rpk';
import { parsePartConfig, type CfgPose, type PartConfig } from '../formats/cfg';

export interface MapObjectPlacement { id: number; alias: string; typeId: number; pose: CfgPose }

/** Object instances exist in the map's source RDB even when omitted from its compiled RPK. */
export function mapObjectPlacements(rdb: string, pack: RpkPack): MapObjectPlacement[] {
  const files = parseRdb(rdb), byName = new Map(files.map(file => [file.name.toLowerCase(), file]));
  const placements: MapObjectPlacement[] = [];
  for (const file of files) {
    if (!/^[0-9a-f]+\.res$/i.test(file.name) || !file.properties.some(p => p.key === 'typeof' && p.value === '1')) continue;
    const id = Number.parseInt(file.name, 16), payload = byName.get(file.name.replace(/\.res$/i, '.rsd').toLowerCase());
    const gameType = payload?.properties.find(p => p.key === 'gametype')?.value;
    const params = payload?.properties.find(p => p.key === 'params')?.value;
    if (!gameType || !/^0x[\da-f]+$/i.test(gameType) || !params) continue;
    const values = params.split(',').map(v => Number(v.trim()));
    if (values.length !== 6 || values.some(v => !Number.isFinite(v))) continue;
    const typeId = Number.parseInt(gameType.slice(2), 16) >>> 0;
    if (typeId >>> 16 && !pack.dependencies.some(dep => dep.id >>> 16 === typeId >>> 16)) continue;
    placements.push({ id, alias: file.properties.find(p => p.key === 'alias')?.value ?? '', typeId,
      pose: { position: values.slice(0, 3) as CfgPose['position'], rotation: values.slice(3) as CfgPose['rotation'] } });
  }
  return placements;
}

/** Compiled game-type payload: ICFG header, subtype name, then native CFG text. */
export function parseIcfg(data: Uint8Array): PartConfig {
  if (new TextDecoder().decode(data.subarray(0, 4)) !== 'ICFG' || data.length < 16) throw new Error('Invalid ICFG payload');
  const subtypeEnd = data.indexOf(0, 8);
  if (subtypeEnd < 8) throw new Error('ICFG subtype missing');
  const source = new TextDecoder('windows-1252').decode(data.subarray(subtypeEnd + 1)).replace(/\0+$/, '')
    // A few stock City lamp CFGs have an omitted separator in a rotation value
    // (for example "-1.570.000000" where the intended values are -1.570 and 0.000000).
    .replace(/(-?\d+\.\d{3})(\.\d{6})(?=\s)/g, '$1 $2');
  return parsePartConfig(source);
}

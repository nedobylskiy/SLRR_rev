import { entryProperties, type RpkPack } from '../formats/rpk';

/** Render resources belonging to a map. The SCX vertices already contain map-space positions. */
export function mapRenderIds(pack: RpkPack): number[] {
  const byId = new Map(pack.entries.map(entry => [entry.typeId, entry]));
  return pack.entries.filter(entry => entry.type === 14 && byId.get(entry.superId)?.type === 14 && entryProperties(entry).some(prop =>
    prop.key === 'mesh' && /^0x[0-9a-f]+$/i.test(prop.value) && byId.get(Number.parseInt(prop.value.slice(2), 16))?.type === 5
  )).map(entry => entry.typeId);
}

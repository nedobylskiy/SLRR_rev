/** Categories are based on stock resource aliases, never on object size alone:
 * small buildings and road chunks must not disappear with street furniture. */
export type MapObjectCategory='trees'|'streetlights'|'bins'|'small-props';
export const mapObjectCategories:readonly MapObjectCategory[]=['trees','streetlights','bins','small-props'];
export function isMapTreeAlias(alias:string){
  return /^fa\d+[a-z]?(?:[_ -]lod\d*)?$/i.test(alias.trim())||/^(?:tree|tree_obj|palm)(?:[_ -]|$)/i.test(alias.trim());
}
export function mapObjectCategory(alias:string):MapObjectCategory|undefined{
  const name=alias.trim().toLowerCase();
  if(isMapTreeAlias(name))return 'trees';
  if(/^(?:lamp(?:a)?(?:_|$)|kislampa$|korbelampa$|trafficlamp(?:_|$)|villanyoszlop$|highwayoszlop$|pozna$)/.test(name))return 'streetlights';
  if(/^(?:kuka(?:_|$)|trash(?:_|$)|bin(?:_|$)|dustbin(?:_|$))/.test(name))return 'bins';
  if(/^(?:pad|telefon|tuzcsap|utlezaro|boja|bolya|hotdogos|hutotaska|jegkremes|napagy2?|napernyo|kontener|ventillator|wheel|viraglada|bokor|kaktusz|sator|trailer)$/.test(name)
    ||/^(?:tabla|lada|reklam|vreklam|korlat)(?:_|\d)/.test(name)||name==='balratabla')return 'small-props';
  return undefined;
}

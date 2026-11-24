/** Triangle budgets of the generated levels; level k (1-based) keeps LOD_RATIOS[k - 1] of the source. */
export const LOD_RATIOS=[.9,.8,.7,.6,.5,.4,.3,.2] as const;
export const LOD_LEVELS=LOD_RATIOS.length;
/**
 * Error ceiling per level as a fraction of the model diagonal. The first three levels (inside ~100 m) stay
 * near-invisible; further out the ceiling widens so low-poly trees and traffic still reach their budgets.
 */
export const LOD_MAX_ERROR=[.02,.02,.02,.04,.07,.1,.15,.25] as const;
/** Full detail at or inside this camera distance (metres). */
export const LOD_NEAR=40;

/**
 * Continuous level 0..LOD_LEVELS: 0 at LOD_NEAR, the coarsest level at the view distance.
 * Level k starts at LOD_NEAR·(far/LOD_NEAR)^(k/LOD_LEVELS): every step shrinks the on-screen size by the same
 * factor, so steps are a few metres apart near the camera and wide towards the edge of view
 * (300 m view: 90% from ~52 m, 50% from ~141 m, 20% at 300 m).
 */
/** Strength slider range: 1 reaches the coarsest level at the view distance, higher values bring it closer. */
export const LOD_STRENGTH_MAX=6;
/** Distance at which the coarsest level starts: the view distance divided by the strength, never inside 60 m. */
export function lodReach(viewDistance:number,strength=1):number {
  return Math.max(LOD_NEAR+20,viewDistance/Math.min(LOD_STRENGTH_MAX,Math.max(1,strength)));
}
export function lodScale(distance:number,far:number):number {
  const span=Math.max(far,LOD_NEAR*1.5);
  if(!(distance>LOD_NEAR))return 0;
  if(distance>=span)return LOD_LEVELS;
  return LOD_LEVELS*Math.log(distance/LOD_NEAR)/Math.log(span/LOD_NEAR);
}

/** Level whose start distance has been passed, with a ±4% distance band around each switch against flicker. */
export function lodLevel(distance:number,far:number,current=-1):number {
  if(current>=0){
    const nearer=Math.floor(lodScale(distance*.96,far)),farther=Math.floor(lodScale(distance*1.04,far));
    if(current>=nearer&&current<=farther)return current;
  }
  return Math.floor(lodScale(distance,far));
}

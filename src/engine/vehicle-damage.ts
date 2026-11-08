import { Vector3 } from 'three';
import type { EnginePart } from './world';
import type { PanelDamageState } from './deformable-panel';

export interface PartDamageState {
  path: number[];
  resource: { pack: string; id: number };
  condition: number;
  connected: boolean;
  local: number[];
  panel?: PanelDamageState;
  rigidForce?: number;
}
export interface VehicleDamageState { version: 1; parts: PartDamageState[]; wheels: { damage: number[]; hardpoint: number[]; condition: number }[] }

export function damageParts(root: EnginePart, damage: VehicleDamageState): Map<EnginePart, PartDamageState> {
  const result = new Map<EnginePart, PartDamageState>();
  for (const state of damage.parts) {
    let part: EnginePart | undefined = root;
    for (const slot of state.path) part = part?.children.get(slot);
    if (part && part.definition.key.pack === state.resource.pack && part.definition.key.id === state.resource.id)
      result.set(part, state);
  }
  return result;
}
export function applyAssemblyDamage(root: EnginePart, damage: VehicleDamageState) {
  for (const part of root.world.parts.values()) part.savedDamage=undefined;
  for (const [part, state] of damageParts(root, damage)) {
    part.condition = state.condition;
    part.savedDamage = state;
    if (part !== root) {
      if (!state.connected && part.parent) part.world.detach(part);
      else if (state.connected) part.local.fromArray(state.local);
    }
  }
}

/** Reject malformed extension data before touching the live assembly. */
export function validateVehicleDamage(value: unknown): asserts value is VehicleDamageState {
  const state = value as VehicleDamageState;
  const numbers = (a: unknown, count?: number): a is number[] => Array.isArray(a)
    && (count === undefined || a.length === count) && a.every(n => typeof n === 'number' && Number.isFinite(n));
  if (!state || state.version !== 1 || !Array.isArray(state.parts) || state.parts.length > 10000
    || !Array.isArray(state.wheels) || state.wheels.length > 4) throw new Error('Invalid vehicle damage state');
  const paths = new Set<string>();
  for (const part of state.parts) {
    if (!part || !numbers(part.path) || part.path.length > 120 || part.path.some(n => !Number.isSafeInteger(n) || n <= 0)
      || paths.has(part.path.join('/')) || !part.resource || typeof part.resource.pack !== 'string'
      || !Number.isSafeInteger(part.resource.id) || typeof part.connected !== 'boolean'
      || !Number.isFinite(part.condition) || part.condition < 0 || part.condition > 1 || !numbers(part.local, 16))
      throw new Error('Invalid saved part damage');
    if(part.rigidForce!==undefined&&(!Number.isFinite(part.rigidForce)||part.rigidForce<0))throw new Error('Invalid saved rigid attachment load');
    paths.add(part.path.join('/'));
    const panel = part.panel;
    if (panel) {
      if (!Number.isInteger(panel.nx) || !Number.isInteger(panel.nz) || panel.nx < 3 || panel.nx > 16 || panel.nz < 3 || panel.nz > 16
        || !numbers(panel.bounds, 4) || panel.bounds[1] <= panel.bounds[0] || panel.bounds[3] <= panel.bounds[2]
        || !Number.isFinite(panel.thickness) || panel.thickness <= 0) throw new Error('Invalid saved cage bounds');
      const count = panel.nx * panel.nz * 6;
      if (!numbers(panel.positions, count) || !numbers(panel.template, count) || !numbers(panel.rest, count)
        || !numbers(panel.velocities, count) || !numbers(panel.beams) || panel.beams.length > 20000 || panel.beams.some(n => n <= 0)
        || !Array.isArray(panel.mounts) || panel.mounts.length > 16 || panel.mounts.some(m => !m || typeof m.broken !== 'boolean'
          || !Number.isFinite(m.force) || !Number.isFinite(m.overload))) throw new Error('Invalid saved cage state');
    }
  }
  for (const wheel of state.wheels) if (!wheel || !numbers(wheel.damage,16) || !numbers(wheel.hardpoint,3) || !Number.isFinite(wheel.condition)
    || wheel.condition < 0 || wheel.condition > 1) throw new Error('Invalid saved wheel damage');
}

/** Same eight-node binding as the running solver, without constructing a solver in the garage. */
export function skinSavedPanel(panel: PanelDamageState, point: Vector3): Vector3 {
  const [minX,maxX,minZ,maxZ] = panel.bounds;
  const u = Math.max(0,Math.min(1,(point.x-minX)/(maxX-minX)))*(panel.nx-1);
  const v = Math.max(0,Math.min(1,(point.z-minZ)/(maxZ-minZ)))*(panel.nz-1);
  const x=Math.min(Math.floor(u),panel.nx-2), z=Math.min(Math.floor(v),panel.nz-2), a=u-x,b=v-z;
  const nodes=[z*panel.nx+x,z*panel.nx+x+1,(z+1)*panel.nx+x,(z+1)*panel.nx+x+1];
  const weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];
  const bottom=nodes.reduce((sum,n,i)=>sum+panel.template[n*3+1]*weights[i],0);
  const t=(point.y-bottom)/panel.thickness, out=new Vector3();
  for(let i=0;i<4;i++) {
    out.addScaledVector(new Vector3().fromArray(panel.positions,nodes[i]*3),weights[i]*(1-t));
    out.addScaledVector(new Vector3().fromArray(panel.positions,(nodes[i]+panel.nx*panel.nz)*3),weights[i]*t);
  }
  return out;
}

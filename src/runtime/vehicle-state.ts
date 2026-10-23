import { normalizePath } from '../assets';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ResourceKey { pack: string; localId: number }
export interface PartState {
  id: string; parentId: string | null; parentSlot: number; ownSlot: number;
  resource: ResourceKey; texture: ResourceKey | null; mesh: ResourceKey | null;
  position: Vec3; rotation: Quat; wear: number; tear: number;
  /** Versioned mod-specific fields; all references must use stable IDs, never native pointers. */
  scriptVersion: number; script: { [key: string]: JsonValue };
}
export interface VehicleState {
  vehicleId: string; tick: number; contentHash: string; rootPartId: string;
  position: Vec3; rotation: Quat; linearVelocity: Vec3; angularVelocity: Vec3;
  rpm: number; gear: number; parts: PartState[];
}

const MAX_BYTES = 4 * 1024 * 1024;
function uint(n: unknown): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff; }
function finite(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n); }
function record(n: unknown): n is Record<string, unknown> { return n !== null && typeof n === 'object' && !Array.isArray(n); }
function vector(n: unknown, length: number) { return Array.isArray(n) && n.length === length && n.every(finite); }
function quaternion(n: unknown) {
  if (!vector(n, 4)) return false;
  const length = Math.hypot(...n as number[]); return Math.abs(length - 1) < 0.001;
}
function identifier(n: unknown): n is string { return typeof n === 'string' && n.length > 0 && n.length <= 256; }
function resource(n: unknown, nullable = false): boolean {
  if (nullable && n === null) return true;
  if (!record(n) || typeof n.pack !== 'string' || !uint(n.localId) || n.localId < 1 || n.localId > 0xffff) return false;
  try { return normalizePath(n.pack) === n.pack && n.pack.length <= 512; } catch { return false; }
}
function checkJson(n: unknown, depth = 0, ancestors = new Set<object>()): boolean {
  if (depth > 32) return false;
  if (n === null || typeof n === 'string' || typeof n === 'boolean') return true;
  if (typeof n === 'number') return finite(n);
  if (typeof n !== 'object' || ancestors.has(n)) return false;
  ancestors.add(n);
  const valid = Array.isArray(n) ? n.every(v => checkJson(v, depth + 1, ancestors))
    : (Object.getPrototypeOf(n) === Object.prototype || Object.getPrototypeOf(n) === null)
      && Object.entries(n).every(([k, v]) => !['__proto__', 'constructor', 'prototype'].includes(k) && checkJson(v, depth + 1, ancestors));
  ancestors.delete(n); return valid;
}

export function validateVehicleState(value: unknown): asserts value is VehicleState {
  if (!record(value) || !identifier(value.vehicleId) || !uint(value.tick) || !identifier(value.contentHash) || !identifier(value.rootPartId)
    || !vector(value.position, 3) || !quaternion(value.rotation) || !vector(value.linearVelocity, 3) || !vector(value.angularVelocity, 3)
    || !finite(value.rpm) || !Number.isInteger(value.gear) || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 10_000)
    throw new Error('Invalid vehicle state header');
  const ids = new Map<string, PartState>();
  for (const p of value.parts) {
    if (!record(p) || !identifier(p.id) || ids.has(p.id) || !(p.parentId === null || identifier(p.parentId)) || !uint(p.parentSlot) || !uint(p.ownSlot)
      || !resource(p.resource) || !resource(p.texture, true) || !resource(p.mesh, true) || !vector(p.position, 3) || !quaternion(p.rotation)
      || !finite(p.wear) || !finite(p.tear) || !uint(p.scriptVersion) || !record(p.script) || !checkJson(p.script)) throw new Error('Invalid part state');
    ids.set(p.id, p as unknown as PartState);
  }
  const root = ids.get(value.rootPartId);
  if (!root || root.parentId !== null || [...ids.values()].filter(p => p.parentId === null).length !== 1) throw new Error('Invalid vehicle root');
  for (const p of ids.values()) {
    const visited = new Set<string>(); let cursor: PartState | undefined = p;
    while (cursor && cursor.parentId !== null) {
      if (visited.has(cursor.id)) throw new Error('Cycle in vehicle parts');
      visited.add(cursor.id); cursor = ids.get(cursor.parentId);
      if (!cursor) throw new Error('Missing parent part');
    }
  }
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

/** New engine wire format. NOT a legacy SDAT file. No filesystem APIs, no retained vehicle references. */
export function serializeVehicle(state: VehicleState): Uint8Array {
  validateVehicleState(state);
  const payload = new TextEncoder().encode(JSON.stringify(state));
  if (payload.length > MAX_BYTES) throw new Error('Vehicle snapshot exceeds 4 MiB');
  const bytes = new Uint8Array(16 + payload.length), view = new DataView(bytes.buffer);
  bytes.set([83, 82, 86, 83]); // SRVS
  view.setUint32(4, 1, true); view.setUint32(8, payload.length, true); view.setUint32(12, crc32(payload), true); bytes.set(payload, 16);
  return bytes;
}

export function deserializeVehicle(bytes: Uint8Array, expectedContentHash?: string): VehicleState {
  if (bytes.length < 16 || bytes.length > MAX_BYTES + 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'SRVS') throw new Error('Invalid SRVS header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== bytes.length - 16) throw new Error('Unsupported/truncated SRVS');
  const payload = bytes.subarray(16);
  if (crc32(payload) !== view.getUint32(12, true)) throw new Error('Corrupted SRVS payload');
  const state: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  validateVehicleState(state);
  if (expectedContentHash !== undefined && state.contentHash !== expectedContentHash) throw new Error('Vehicle content manifest mismatch');
  return state;
}

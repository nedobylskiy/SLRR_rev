import { BinaryReader } from '../binary';

export interface ScxMesh {
  name: string; positions: Float32Array; normals: Float32Array;
  uv: Float32Array; uv2?: Float32Array; uv3?: Float32Array;
  indices: Uint32Array; diffuse: number[]; textureIndex: number;
  layer2Index?: number; materialFlags?: number; textureChannel?: number; layer2Channel?: number;
  textureMap?: { channel: number; tiling: number; scaleU: number; scaleV: number; offsetU: number; offsetV: number };
  lightmapIndex?: number; lightmapMap?: { channel: number; tiling: number; scaleU: number; scaleV: number; offsetU: number; offsetV: number };
  selfIllumIndex?: number; selfIllumMap?: { channel: number; tiling: number; scaleU: number; scaleV: number; offsetU: number; offsetV: number };
}
export interface ScxModel { version: number; meshes: ScxMesh[]; warnings: string[] }

/** V3's alphaOpacity flag controls whether diffuse-map alpha affects the surface. */
export function scxDiffuseUsesAlpha(version: number, materialFlags = 0) {
  return version !== 3 || (materialFlags & 1) !== 0;
}

function validate(mesh: ScxMesh) {
  if (mesh.indices.length % 3) throw new Error('SCX: incomplete triangle');
  for (const n of mesh.positions) if (!Number.isFinite(n)) throw new Error('SCX: non-finite position');
  for (const i of mesh.indices) if (i >= mesh.positions.length / 3) throw new Error(`SCX: index ${i} exceeds vertex count`);
}

/** Coordinates remain in original axes/units; renderer decides the world transform. */
export function parseScx(bytes: Uint8Array): ScxModel {
  const r = new BinaryReader(bytes, 'SCX');
  if (r.text(4) !== 'INVO') throw new Error('Not an INVO mesh');
  const version = r.u32();
  const meshes: ScxMesh[] = [], warnings: string[] = [];
  if (version === 3) {
    while (r.remaining >= 4) {
      const start = r.offset, size = r.u32();
      if (size === 0) {
        if (r.remaining) warnings.push(`${r.remaining} trailing bytes after material terminator`);
        break;
      }
      if (![56, 104, 136].includes(size)) throw new Error(`SCX v3: unsupported material size ${size}`);
      r.require(size - 4);
      const diffuse = Array.from({ length: 4 }, () => r.f32());
      r.seek(start + 40);
      const materialFlags = r.u32();
      r.seek(start + 44);
      const textureIndex = r.u16();
      r.skip(6);
      const layer2Index = r.u16();
      let textureChannel = 0, layer2Channel = 0;
      if (size > 56) { r.seek(start + 70); textureChannel = r.u16(); layer2Channel = r.u16(); }
      r.seek(start + 104 <= start + size ? start + 104 : start + size);
      const name = size === 136 ? r.cstring(32) : `material_${meshes.length}`;
      r.seek(start + size);
      const count = r.count(r.u32(), size > 56 ? 64 : 44);
      const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uv = new Float32Array(count * 2), uv2 = new Float32Array(count * 2);
      const uv3 = size > 56 ? new Float32Array(count * 2) : undefined;
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < 3; j++) positions[i * 3 + j] = r.f32();
        for (let j = 0; j < 3; j++) normals[i * 3 + j] = r.f32();
        uv[i * 2] = r.f32(); uv[i * 2 + 1] = r.f32();
        uv2[i * 2] = r.f32(); uv2[i * 2 + 1] = r.f32();
        r.skip(4);
        if (uv3) { r.skip(8); uv3[i * 2] = r.f32(); uv3[i * 2 + 1] = r.f32(); r.skip(4); }
      }
      const triangles = r.count(r.u32(), 12);
      const indices = Uint32Array.from({ length: triangles * 3 }, () => r.u32());
      const mesh = { name, positions, normals, uv, uv2, uv3, indices, diffuse,
        textureIndex, layer2Index, materialFlags, textureChannel, layer2Channel };
      validate(mesh); meshes.push(mesh);
    }
    if (r.remaining > 0 && r.remaining < 4) throw new Error('SCX v3: truncated tail');
  } else if (version === 4) {
    const count = r.count(r.u32(), 8);
    const directory = Array.from({ length: count }, () => ({ type: r.u32(), offset: r.u32() }));
    const physicsOnly = directory[0]?.type === 1;
    let current: Partial<ScxMesh> | undefined;
    const finish = () => {
      if (!current) return;
      if (!current.positions || !current.indices) throw new Error('SCX v4: incomplete mesh group');
      const vertices = current.positions.length / 3;
      const mesh: ScxMesh = { name: current.name ?? `material_${meshes.length}`, positions: current.positions,
        normals: current.normals ?? new Float32Array(vertices * 3), uv: current.uv ?? new Float32Array(vertices * 2),
        uv2: current.uv2, uv3: current.uv3, textureMap: current.textureMap,
        lightmapIndex: current.lightmapIndex, lightmapMap: current.lightmapMap,
        selfIllumIndex: current.selfIllumIndex, selfIllumMap: current.selfIllumMap,
        indices: current.indices, diffuse: current.diffuse ?? [0.6, 0.65, 0.7, 1], textureIndex: current.textureIndex ?? 0xffff };
      validate(mesh); meshes.push(mesh);
    };
    for (const item of directory) {
      r.seek(item.offset);
      if (r.u32() !== item.type) throw new Error('SCX v4: directory type mismatch');
      const size = r.u32();
      if (size < 8) throw new Error('SCX v4: invalid chunk size');
      r.require(size - 8); // Includes the type/size header (confirmed against local v4 corpus).
      const end = item.offset + size;
      if (item.type === 0 || (item.type === 1 && physicsOnly)) {
        finish(); current = {};
        if (item.type === 0) {
          r.skip(8); const n = r.count(r.u32(), 4);
          for (let j = 0; j < n; j++) {
            const type = r.u32();
            if (type <= 2) { const color = Array.from({ length: 4 }, () => r.u8() / 255); if (type === 0) current.diffuse = color; }
            else if (type >= 0x01000000 && type <= 0x01000002) r.skip(4);
            else if (type === 0x05000000 || type === 0x07000000) {
              r.skip(4); warnings.push(`Material property 0x${type.toString(16)}: value read, shading semantics not implemented`);
            }
            else if (type >= 0x06000000 && type <= 0x06000005) {
              const index = r.u32();
              const map = { channel: r.u32(), tiling: r.u32(), scaleU: r.f32(), scaleV: r.f32(), offsetU: r.f32(), offsetV: r.f32() };
              // Some v4 materials (including Test Track containers) contain only DiffuseMixSecond.
              // Keep DiffuseMap authoritative when both entries are present, regardless of their order.
              if (type === 0x06000000 || (type === 0x06000001 && current.textureIndex === undefined)) {
                current.textureIndex = index; current.textureMap = map;
              }
              if (type === 0x06000004) { current.lightmapIndex = index; current.lightmapMap = map; }
              if (type === 0x06000005) { current.selfIllumIndex = index; current.selfIllumMap = map; }
            }
            else if (type === 0x08000000) current.name = r.cstring(32);
            else throw new Error(`SCX v4: unknown material entry 0x${type.toString(16)}`);
          }
        }
      } else if (item.type === 4) {
        if (!current) throw new Error('SCX v4: vertices before mesh');
        if (current.positions) {
          const { name, diffuse, textureIndex, textureMap, lightmapIndex, lightmapMap, selfIllumIndex, selfIllumMap } = current;
          finish(); current = { name, diffuse, textureIndex, textureMap, lightmapIndex, lightmapMap, selfIllumIndex, selfIllumMap };
        }
        const n = r.u32(), flags = r.u32();
        if (!(flags & 1) || flags & ~0x40fff) throw new Error(`SCX v4: unsupported vertex flags 0x${flags.toString(16)}`);
        r.count(n, 12);
        current.positions = new Float32Array(n * 3); current.normals = new Float32Array(n * 3); current.uv = new Float32Array(n * 2);
        if (flags & 0x400) current.uv2 = new Float32Array(n * 2);
        if (flags & 0x800) current.uv3 = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < 3; j++) current.positions[i * 3 + j] = r.f32();
          // Weight flag encodes 1..4 influences; the last weight is implicit.
          if (flags & 4) r.skip(4); else if (flags & 8) r.skip(8); else if (flags & 16) r.skip(12);
          if (flags & 32) r.skip(4);
          if (flags & 0x40) for (let j = 0; j < 3; j++) current.normals[i * 3 + j] = r.f32();
          if (flags & 0x80) r.skip(4); if (flags & 0x100) r.skip(4);
          if (flags & 0x200) { current.uv[i * 2] = r.f32(); current.uv[i * 2 + 1] = r.f32(); }
          if (current.uv2) { current.uv2[i * 2] = r.f32(); current.uv2[i * 2 + 1] = r.f32(); }
          if (current.uv3) { current.uv3[i * 2] = r.f32(); current.uv3[i * 2 + 1] = r.f32(); }
          if (flags & 0x40000) r.skip(12);
        }
      } else if (item.type === 5) {
        if (!current) throw new Error('SCX v4: indices before mesh');
        const n = r.count(r.u32(), 2);
        current.indices = Uint32Array.from({ length: n }, () => r.u16());
      } else if (item.type !== 1) warnings.push(`Chunk type ${item.type}: skeleton data retained in source, not rendered`);
      if (r.offset > end) throw new Error('SCX v4: chunk overrun');
    }
    finish();
  } else throw new Error(`Unsupported SCX version ${version}`);
  if (!meshes.length) warnings.push('Empty SCX placeholder: no geometry');
  return { version, meshes, warnings };
}

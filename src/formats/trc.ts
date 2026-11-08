/** Original city TRC record framing. Unknown words are retained, not assigned gameplay meaning. */
export type RoadPoint = [number, number, number];
export interface RoadSegment { start: RoadPoint; end: RoadPoint; startTangent: RoadPoint; endTangent: RoadPoint; length: number; raw: Uint32Array; flag: number }
export interface RoadNode { id: number; group: 0 | 1; position: RoadPoint; links: { target: number; flag: number }[]; lanes: { header: Uint8Array; segment: RoadSegment }[]; raw: Uint32Array }
export interface RoadPath { id: number; refs: number[]; raw: Uint32Array; segments: RoadSegment[] }
export interface RoadOther extends RoadPath { flag: number; extraRefs: number[]; tail: Uint32Array }
export interface RoadNetwork { version: number; nodes: RoadNode[]; paths: RoadPath[]; others: RoadOther[]; bytes: number }

export function roadWordFloat(word: number): number {
  const bytes = new ArrayBuffer(4), view = new DataView(bytes);
  view.setUint32(0, word, true); return view.getFloat32(0, true);
}

export function parseTrc(bytes: Uint8Array): RoadNetwork {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0;
  const need = (n: number) => { if (n < 0 || offset + n > bytes.length) throw Error(`TRC: truncated record at ${offset}`); };
  const u32 = () => { need(4); const n = view.getUint32(offset, true); offset += 4; return n; };
  const u8 = () => { need(1); return bytes[offset++]; };
  const words = (n: number) => Uint32Array.from({ length: n }, u32);
  const count = (minimum: number) => { const n = u32(); if (n > Math.floor((bytes.length - offset) / minimum)) throw Error(`TRC: invalid count at ${offset - 4}`); return n; };
  const version = u32(); if (version !== 1) throw Error(`TRC: unsupported version ${version}`);
  const counts = Array.from({ length: 4 }, () => count(4)), total = counts.reduce((a, b) => a + b, 0);
  if (total > bytes.length / 4) throw Error('TRC: invalid record total');
  const ref = () => { const id = u32(); if (id > total) throw Error(`TRC: reference ${id} outside record table`); return id; };
  const point = (raw: Uint32Array, start: number): RoadPoint => {
    const p = Array.from(raw.slice(start, start + 3), roadWordFloat) as RoadPoint;
    if (!p.every(Number.isFinite)) throw Error('TRC: non-finite geometry'); return p;
  };
  const segment = (): RoadSegment => {
    const raw = words(14), flag = u8();
    const length = roadWordFloat(raw[12]);
    if (!Number.isFinite(length) || length < 0) throw Error('TRC: invalid segment length');
    return { start: point(raw, 0), end: point(raw, 3), startTangent: point(raw, 6), endTangent: point(raw, 9), length, raw, flag };
  };
  const segments = () => {
    const n = count(57); if (!n) throw Error('TRC: empty spline');
    return Array.from({ length: n }, segment);
  };
  let id = 0; const nodes: RoadNode[] = [], paths: RoadPath[] = [], others: RoadOther[] = [];
  for (const group of [0, 1] as const) for (let i = 0; i < counts[group]; i++) {
    const links = Array.from({ length: count(5) }, () => ({ target: ref(), flag: u8() }));
    const lanes = Array.from({ length: count(69) }, () => {
      need(12); const header = bytes.slice(offset, offset + 12); offset += 12; return { header, segment: segment() };
    });
    const raw = words(4); nodes.push({ id: ++id, group, position: point(raw, 0), links, lanes, raw });
  }
  for (let i = 0; i < counts[2]; i++) paths.push({ id: ++id, refs: [ref(), ref(), ref()], raw: words(7), segments: segments() });
  for (let i = 0; i < counts[3]; i++) {
    const refs = [ref(), ref()], flag = u8(), raw = words(12), extraRefs = [ref(), ref(), ref(), ref()], tail = words(3);
    others.push({ id: ++id, refs, flag, raw, extraRefs, tail, segments: segments() });
  }
  if (offset !== bytes.length) throw Error(`TRC: ${bytes.length - offset} trailing bytes`);
  return { version, nodes, paths, others, bytes: bytes.length };
}

/** Cubic Hermite interpolation in map metres, without SCX centimetre scaling. */
export function sampleRoadSegment(segment: RoadSegment, t: number): RoadPoint {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(i => (2 * t3 - 3 * t2 + 1) * segment.start[i]
    + (t3 - 2 * t2 + t) * segment.startTangent[i]
    + (-2 * t3 + 3 * t2) * segment.end[i] + (t3 - t2) * segment.endTangent[i]) as RoadPoint;
}

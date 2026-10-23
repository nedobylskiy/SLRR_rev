import { BinaryReader } from '../binary';

export type Constant = { kind: 0; value: string } | { kind: 1 | 2 | 4; value: number } | { kind: 3 | 5 | 6 | 7; a: number; b: number };
export interface TreeNode { op: number; source: number; operand?: number; offset: number }
export interface TufaMethod { flags: number; name: string; signature: string; tree: number; localCount: number }
export interface TufaClass {
  version: number; name: string; superName: string; constants: Constant[];
  methods: TufaMethod[]; trees: TreeNode[][];
  sections: { tag: string; data: Uint8Array; offset: number }[];
}

// Serialized widths from the public reconstruction; semantics are NOT Java bytecode.
const wideOps = new Set([1, 2, 3, 6, 7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 20, 21, 22, 23, 25, 26, 27, 28, 30, 31, 37, 38, 39, 46]);

export function parseConstants(bytes: Uint8Array): Constant[] {
  const r = new BinaryReader(bytes, 'TUFA CONS');
  const count = r.count(r.u32(), 8), constants: Constant[] = [];
  for (let i = 0; i < count; i++) {
    const kind = r.u32();
    if (kind === 0) {
      const value = r.text(r.u32());
      if (r.u8() !== 0) throw new Error(`CONS string ${i}: missing NUL`);
      constants.push({ kind, value });
    } else if (kind === 1 || kind === 2 || kind === 4) constants.push({ kind, value: r.u32() });
    else if (kind === 3 || kind === 5 || kind === 6 || kind === 7) constants.push({ kind, a: r.u32(), b: r.u32() });
    else throw new Error(`CONS: unknown kind ${kind} at entry ${i}`);
  }
  if (r.remaining) throw new Error(`CONS: ${r.remaining} unconsumed bytes`);
  return constants;
}

export function constantString(constants: Constant[], index: number): string {
  const value = constants[index];
  if (value?.kind === 0) return value.value;
  if (value?.kind === 4) {
    const target = constants[value.value];
    if (target?.kind === 0) return target.value;
  }
  return '';
}

export function parseTrees(bytes: Uint8Array): TreeNode[][] {
  const r = new BinaryReader(bytes, 'TUFA TREE');
  const count = r.count(r.u32(), 4), trees: TreeNode[][] = [];
  for (let i = 0; i < count; i++) {
    const n = r.count(r.u32(), 3), nodes: TreeNode[] = [];
    for (let j = 0; j < n; j++) {
      const offset = r.offset, op = r.u8(), source = r.u16();
      nodes.push({ op, source, offset, ...(wideOps.has(op) ? { operand: r.u32() } : {}) });
    }
    trees.push(nodes);
  }
  if (r.remaining) throw new Error(`TREE: ${r.remaining} unconsumed bytes`);
  return trees;
}

/** One file can contain multiple concatenated TUFA classes. */
export function parseTufa(bytes: Uint8Array): TufaClass[] {
  const r = new BinaryReader(bytes, 'TUFA'), classes: TufaClass[] = [];
  while (r.remaining) {
    if (r.text(4) !== 'TUFA' || r.u32() !== 4) throw new Error('Invalid TUFA header');
    const version = r.u32(), sections: TufaClass['sections'] = [];
    while (r.remaining) {
      r.require(8);
      if (r.view.getUint32(r.offset, true) === 0x41465554) break;
      const tag = r.text(4), size = r.u32(), offset = r.offset;
      sections.push({ tag, data: r.take(size), offset });
    }
    const section = (tag: string) => sections.find(s => s.tag === tag)?.data;
    const cons = section('CONS'), clss = section('CLSS');
    if (!cons || !clss) throw new Error('TUFA missing CONS/CLSS');
    const constants = parseConstants(cons);
    const c = new BinaryReader(clss, 'CLSS'); c.skip(8);
    const name = constantString(constants, c.u32()), superName = constantString(constants, c.u32());
    if (!name) throw new Error('TUFA: invalid class name');
    const treeBytes = section('TREE'), trees = treeBytes ? parseTrees(treeBytes) : [];
    const methods: TufaMethod[] = [];
    const methodBytes = section('MTHD');
    if (methodBytes) {
      const m = new BinaryReader(methodBytes, 'MTHD');
      const first = m.u32();
      // Two separately counted partitions; each record is five flags/name/signature/tree/local words.
      m.count(first, 20);
      for (let i = 0; i < first; i++) {
        const flags = m.u32(), name = constantString(constants, m.u32()), signature = constantString(constants, m.u32());
        methods.push({ flags, name, signature, tree: m.u32(), localCount: m.u32() });
      }
      const second = m.count(m.u32(), 20);
      for (let i = 0; i < second; i++) {
        const flags = m.u32(), name = constantString(constants, m.u32()), signature = constantString(constants, m.u32());
        methods.push({ flags, name, signature, tree: m.u32(), localCount: m.u32() });
      }
      if (m.remaining) throw new Error(`MTHD: ${m.remaining} unconsumed bytes`);
    }
    classes.push({ version, name, superName, constants, methods, trees, sections });
  }
  return classes;
}

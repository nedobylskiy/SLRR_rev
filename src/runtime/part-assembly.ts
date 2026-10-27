import { normalizePath } from '../assets';
import { parseSdat, serializeSdat, type Sdat, type SavedResource } from '../formats/sdat';
import { MemoryFile } from './memory-file';
import { JavaSourceMachine, coerce, jv, nil, parseSourceClass, type JavaHost, type JavaValue, type SourceClass } from 'slrr-jvm';

export interface PartDefinition { resource: SavedResource; className: string; slots: number[]; fields?: Record<string, JavaValue> }
interface NativeRecord { tag: string; fields: Map<string, JavaValue> }
interface ResourceHandle { id: number }
interface Transient { kind: number; bytes: Uint8Array }
export interface AssemblySlot { id: number; damage: string | null; child: AssemblyPart | null; childSlot: number }
const key = (r: SavedResource) => `${normalizePath(r.pack)}:${r.localId}`;
const num = (v: JavaValue) => { if (typeof v.value !== 'number' || !Number.isFinite(v.value)) throw new Error('Finite Java number expected'); return v.value; };
function rec(tag: string, fields: Record<string, JavaValue>): JavaValue { return jv(tag, { tag, fields: new Map(Object.entries(fields)) } satisfies NativeRecord); }
function vector(tag: 'Vector3' | 'Ypr', values = [0, 0, 0]) { return rec(tag, Object.fromEntries((tag === 'Vector3' ? ['x', 'y', 'z'] : ['y', 'p', 'r']).map((n, i) => [n, jv('float', Math.fround(values[i] ?? values[0] ?? 0))]))); }
function copy(v: JavaValue): JavaValue {
  const r = v.value as NativeRecord | null;
  return r && typeof r === 'object' && 'tag' in r && 'fields' in r ? jv(v.type, { tag: r.tag, fields: new Map([...r.fields].map(([k, value]) => [k, copy(value)])) }) : { ...v };
}

/** Runtime-local handles never appear directly in the SDAT wire stream. */
class Resources {
  private next = 1;
  private byKey = new Map<string, number>();
  private entries = new Map<number, SavedResource | Transient>();
  reference(resource: SavedResource) {
    if (!Number.isInteger(resource.localId) || resource.localId < 1 || resource.localId > 0xffff) throw new Error('Invalid local resource ID');
    const k = key(resource); let id = this.byKey.get(k);
    if (!id) { id = this.next++; this.byKey.set(k, id); this.entries.set(id, { pack: normalizePath(resource.pack), localId: resource.localId }); }
    return id;
  }
  transient(bytes: Uint8Array, kind = 7) { if (kind !== 7 || bytes.length > 16 * 1024 * 1024) throw new Error('Unsupported transient resource'); const id = this.next++; this.entries.set(id, { kind, bytes: Uint8Array.from(bytes) }); return id; }
  get(id: number) { const resource = this.entries.get(id); if (!resource) throw new Error(`Missing runtime resource ${id}`); return resource; }
  clear() { this.entries.clear(); this.byKey.clear(); }
  get size() { return this.entries.size; }
}

export class AssemblyPart {
  readonly fields = new Map<string, JavaValue>();
  readonly slots: AssemblySlot[];
  texture = 0; mesh = 0; wear = 1; tear = 1; mileage = 0;
  wheelDamage: (string | null)[] = [null, null, null, null];
  parent: AssemblyPart | null = null; parentSlot = 0; ownSlot = 0; updateCount = 0;
  readonly slotTransforms = new Map<number, { position: JavaValue; orientation: JavaValue }>();
  constructor(readonly world: AssemblyWorld, readonly id: number, readonly definition: PartDefinition, readonly resourceId: number) {
    this.slots = definition.slots.map(id => ({ id, damage: null, child: null, childSlot: 0 }));
    this.fields.set('file_ver', jv('int', 3));
    this.fields.set('drag_matrix', rec('Pori', { pos: vector('Vector3'), ori: vector('Ypr') }));
    this.fields.set('suspend_update', jv('int', 0)); this.fields.set('brake_balance', jv('float', 0.5));
    for (const [name, value] of Object.entries(definition.fields ?? {})) this.fields.set(name, copy(value));
  }
  setFloat(name: string, value: number) { this.world.assertLive(this); if (!Number.isFinite(value)) throw new Error('Invalid float'); this.fields.set(name, jv('float', Math.fround(value))); }
  setPose(position: number[], ypr: number[]) { this.world.assertLive(this); if (position.length !== 3 || ypr.length !== 3 || [...position, ...ypr].some(v => !Number.isFinite(v))) throw new Error('Invalid part pose'); this.fields.set('drag_matrix', rec('Pori', { pos: vector('Vector3', position), ori: vector('Ypr', ypr) })); }
  value() { return jv(this.definition.className, this); }
}

export class AssemblyWorld {
  readonly parts = new Map<number, AssemblyPart>();
  readonly resources = new Resources();
  root: AssemblyPart | null = null;
  private nextPart = 1;
  disposed = false;
  constructor(readonly runtime: PartAssemblyRuntime) {}
  create(resource: SavedResource) {
    if (this.disposed || this.parts.size >= 10_000) throw new Error('Disposed world or part count limit');
    const definition = this.runtime.definition(resource), part = new AssemblyPart(this, this.nextPart++, definition, this.resources.reference(resource));
    this.parts.set(part.id, part); return part;
  }
  assertLive(part: AssemblyPart) { if (this.disposed || this.parts.get(part.id) !== part) throw new Error('Stale/disposed part'); }
  attach(parent: AssemblyPart, parentSlot: number, child: AssemblyPart, ownSlot: number) {
    this.assertLive(parent); this.assertLive(child);
    if (parent.world !== this || child.world !== this || parent === child || child.parent) throw new Error('Invalid cross-world/already attached part');
    for (let p: AssemblyPart | null = parent; p; p = p.parent) if (p === child) throw new Error('Attachment cycle');
    const slot = parent.slots.find(s => s.id === parentSlot);
    if (!slot || slot.child || !child.slots.some(s => s.id === ownSlot) || !ownSlot) throw new Error('Missing/occupied attachment slot');
    slot.child = child; slot.childSlot = ownSlot; child.parent = parent; child.parentSlot = parentSlot; child.ownSlot = ownSlot;
  }
  validate(root: AssemblyPart) {
    if (this.disposed || root.world !== this || root.parent) throw new Error('Invalid assembly root');
    const seen = new Set<AssemblyPart>(); const visit = (part: AssemblyPart, depth: number) => {
      if (depth > 120 || seen.has(part)) throw new Error('Assembly cycle/depth exceeded'); seen.add(part);
      this.assertLive(part);
      if (![part.wear, part.tear, part.mileage].every(Number.isFinite)) throw new Error('Non-finite part state');
      const checkValue = (value: JavaValue) => {
        if (typeof value.value === 'number' && !Number.isFinite(value.value)) throw new Error('Non-finite script field');
        const r = value.value as NativeRecord | null;
        if (r && typeof r === 'object' && 'tag' in r && 'fields' in r) for (const v of r.fields.values()) checkValue(v);
      };
      for (const value of part.fields.values()) checkValue(value);
      if (part.texture) this.resources.get(part.texture); if (part.mesh) this.resources.get(part.mesh);
      for (const slot of part.slots) if (slot.child) { if (slot.child.parent !== part || slot.child.parentSlot !== slot.id || slot.child.ownSlot !== slot.childSlot) throw new Error('Broken parent link'); visit(slot.child, depth + 1); }
    }; visit(root, 0);
    if (seen.size !== this.parts.size) throw new Error('Assembly contains unattached/orphan parts');
  }
  dispose() { if (this.disposed) return; for (const part of this.parts.values()) { part.fields.clear(); part.slotTransforms.clear(); for (const slot of part.slots) slot.child = null; part.parent = null; } this.parts.clear(); this.resources.clear(); this.root = null; this.disposed = true; this.runtime.release(this); }
}

class PartMemoryStream {
  readonly file: MemoryFile;
  readonly packs: Map<number, string>;
  readonly unsaved: Sdat['unsaved'];
  private dynamic = new Map<number, number>();
  constructor(readonly world: AssemblyWorld, input?: Sdat) {
    this.file = new MemoryFile(input?.payload); this.packs = new Map(input?.packs); this.unsaved = input?.unsaved.map(r => ({ ...r, bytes: Uint8Array.from(r.bytes) })) ?? [];
  }
  writeResource(id: number) {
    if (!id) { this.file.writeInt(0); return; }
    const resource = this.world.resources.get(id);
    if ('pack' in resource) {
      let ordinal = [...this.packs].find(([, p]) => normalizePath(p) === resource.pack)?.[0];
      if (!ordinal) { ordinal = this.packs.size + 1; if (ordinal >= 0xffff) throw new Error('Pack count overflow'); this.packs.set(ordinal, resource.pack); }
      this.file.writeInt((ordinal << 16) | resource.localId);
    } else {
      let ordinal = this.dynamic.get(id);
      if (!ordinal) { ordinal = this.unsaved.length + 1; if (ordinal > 0xffff) throw new Error('Transient count overflow'); this.dynamic.set(id, ordinal); this.unsaved.push({ ordinal, kind: resource.kind, bytes: Uint8Array.from(resource.bytes) }); }
      this.file.writeInt((0xffff0000 | ordinal) | 0);
    }
  }
  readResource() {
    const wired = this.file.readInt() >>> 0; if (!wired) return 0;
    const ordinal = wired >>> 16;
    if (ordinal && ordinal !== 0xffff) { const pack = this.packs.get(ordinal); if (!pack) throw new Error('Missing SDAT pack ordinal'); return this.world.resources.reference({ pack, localId: wired & 0xffff }); }
    const local = wired & 0xffff; let id = this.dynamic.get(local);
    if (!id) { const res = this.unsaved.find(r => r.ordinal === local); if (!res) throw new Error('Missing transient SDAT resource'); id = this.world.resources.transient(res.bytes, res.kind); this.dynamic.set(local, id); }
    return id;
  }
  bytes() { return serializeSdat({ type: 2, flags: 0, payload: this.file.toBytes(), packs: this.packs, unsaved: this.unsaved }); }
}

/** Executes the actual parsed source bodies of Part/Chassis/subclass serializers. */
export class PartAssemblyRuntime implements JavaHost {
  private classes = new Map<string, SourceClass>();
  private definitions = new Map<string, PartDefinition>();
  private worlds = new Set<AssemblyWorld>();
  private machine: JavaSourceMachine;
  readonly trace: string[] = [];
  constructor(options: { budget?: number; maxDepth?: number } = {}) { this.machine = new JavaSourceMachine(this, options.budget, options.maxDepth); }
  registerSource(source: string) {
    if (source.length > 2 * 1024 * 1024) throw new Error('Java source exceeds limit');
    const cls = parseSourceClass(source); if (this.classes.has(cls.name)) throw new Error(`Duplicate Java class ${cls.name}`);
    const visited = new Set([cls.name]);
    for (let parent = cls.parent; parent; parent = this.classes.get(parent)?.parent ?? null) { if (visited.has(parent)) throw new Error('Java inheritance cycle'); visited.add(parent); }
    this.classes.set(cls.name, cls); return cls;
  }
  registerDefinition(def: PartDefinition) {
    if (!this.classes.has(def.className) || !def.slots.every(id => Number.isInteger(id) && id > 0) || new Set(def.slots).size !== def.slots.length) throw new Error('Invalid part definition');
    const k = key(def.resource); if (this.definitions.has(k)) throw new Error(`Duplicate part definition ${k}`);
    this.definitions.set(k, { ...def, resource: { pack: normalizePath(def.resource.pack), localId: def.resource.localId }, slots: [...def.slots], fields: Object.fromEntries(Object.entries(def.fields ?? {}).map(([k, v]) => [k, copy(v)])) });
  }
  definition(resource: SavedResource) { const def = this.definitions.get(key(resource)); if (!def) throw new Error(`Missing part definition ${key(resource)}`); return def; }
  createWorld() { const world = new AssemblyWorld(this); this.worlds.add(world); return world; }
  release(world: AssemblyWorld) { this.worlds.delete(world); }
  get liveCounts() { return { worlds: this.worlds.size, parts: [...this.worlds].reduce((n, w) => n + w.parts.size, 0), resources: [...this.worlds].reduce((n, w) => n + w.resources.size, 0) }; }
  serialize(root: AssemblyPart) {
    root.world.validate(root); this.trace.length = 0;
    const stream = new PartMemoryStream(root.world);
    this.call(root.value(), 'save', [jv('File', stream)]);
    return stream.bytes();
  }
  restore(bytes: Uint8Array, replace?: AssemblyWorld) {
    if (bytes.length > 64 * 1024 * 1024) throw new Error('Assembly buffer exceeds 64 MiB');
    if (replace && (replace.runtime !== this || replace.disposed)) throw new Error('Invalid replacement world');
    const sdat = parseSdat(bytes), staging = new AssemblyWorld(this), stream = new PartMemoryStream(staging, sdat); this.trace.length = 0;
    try {
      const result = this.call(jv('class', 'Part'), 'createFromFile', [jv('File', stream), jv('GameRef', staging)]);
      if (!(result.value instanceof AssemblyPart)) throw new Error('Part loader did not produce an assembly');
      if (stream.file.position !== stream.file.size) throw new Error(`Unconsumed part payload: ${stream.file.size - stream.file.position} bytes`);
      staging.validate(result.value); staging.root = result.value;
      // Only after full decode/validation succeeds can the old world be destroyed.
      this.worlds.add(staging); replace?.dispose(); return staging;
    } catch (e) { staging.dispose(); throw e; }
  }
  parent(name: string) { return this.classes.get(name)?.parent ?? null; }
  constructorCall(receiver: JavaValue, fromClass: string, target: 'super' | 'this', args: JavaValue[]): JavaValue {
    const name = target === 'super' ? this.parent(fromClass) : fromClass;
    const method = name && this.classes.get(name)?.methods.find(method => method.name === name && method.parameters.length === args.length);
    if (method) return this.machine.invoke(method, receiver, args);
    if (target === 'super' && args.length === 0) return nil();
    throw new Error(`Unsupported part constructor call ${fromClass}.${target}(${args.length})`);
  }
  isInstance(receiver: JavaValue, name: string) {
    if (receiver.value === null) return false;
    for (let current: string | null = receiver.value instanceof AssemblyPart ? receiver.value.definition.className : receiver.type; current; current = this.parent(current))
      if (current === name) return true;
    return false;
  }
  global(name: string): JavaValue {
    const constant = this.classes.get('Part')?.constants.get(name); if (constant) return constant;
    if (name === 'GII_TYPE') return jv('int', 6);
    if (this.classes.has(name)) return jv('class', name);
    throw new Error(`Unknown Java name ${name}`);
  }
  get(receiver: JavaValue, name: string): JavaValue {
    const obj = receiver.value;
    if (obj instanceof AssemblyPart) { const v = obj.fields.get(name); if (!v) throw new Error(`Missing Java field ${obj.definition.className}.${name}`); return v; }
    if (obj && typeof obj === 'object' && 'tag' in obj && 'fields' in obj) { const v = (obj as NativeRecord).fields.get(name); if (v) return v; }
    throw new Error(`Missing Java field ${receiver.type}.${name}`);
  }
  set(receiver: JavaValue, name: string, value: JavaValue) {
    const obj = receiver.value;
    if (obj instanceof AssemblyPart) { const old = obj.fields.get(name); if (!old) throw new Error(`Undeclared field ${name}`); if (name === 'file_ver' && ![1, 2, 3].includes(num(value))) throw new Error('Unsupported PART save version'); obj.fields.set(name, coerce(old.type, value)); return; }
    if (obj && typeof obj === 'object' && 'tag' in obj && 'fields' in obj) { const r = obj as NativeRecord, old = r.fields.get(name); if (!old) throw new Error(`Undeclared field ${name}`); r.fields.set(name, coerce(old.type, value)); return; }
    throw new Error(`Cannot set Java field ${name}`);
  }
  call(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): JavaValue {
    const obj = receiver.value;
    if (obj instanceof AssemblyPart) obj.world.assertLive(obj);
    const className = fromClass ?? (obj instanceof AssemblyPart ? obj.definition.className : receiver.type === 'class' ? String(obj) : undefined);
    if (className) {
      const visited = new Set<string>();
      for (let cls = this.classes.get(className); cls; cls = cls.parent ? this.classes.get(cls.parent) : undefined) {
        if (visited.has(cls.name) || visited.size > 128) throw new Error('Java inheritance cycle/depth'); visited.add(cls.name);
        const candidates = cls.methods.filter(m => m.name === name && m.parameters.length === args.length);
        if (candidates.length > 1) throw new Error(`Ambiguous source overload ${cls.name}.${name}`);
        const method = candidates[0];
        if (method) { this.trace.push(`${cls.name}.${name}`); if (this.trace.length > 30_000) throw new Error('Serializer call count exceeded'); return this.machine.invoke(method, receiver, args); }
      }
    }
    if (obj instanceof PartMemoryStream) {
      if (name === 'readInt') return jv('int', obj.file.readInt());
      if (name === 'readFloat') return jv('float', obj.file.readFloat());
      if (name === 'readString') return jv('String', obj.file.readString());
      if (name === 'readResID') return jv('int', obj.readResource());
      if (name === 'write' && args.length === 1) {
        const v = args[0];
        if (v.type === 'int') obj.file.writeInt(num(v));
        else if (v.type === 'float') obj.file.writeFloat(num(v));
        else if (v.type === 'String') obj.file.writeString(v.value as string | null);
        else if (v.value && typeof v.value === 'object' && 'id' in v.value) obj.writeResource((v.value as ResourceHandle).id);
        else throw new Error(`Unsupported File.write overload ${v.type}`);
        return jv('int', 0);
      }
    }
    if (obj instanceof AssemblyPart) return this.partNative(obj, name, args);
    if (obj && typeof obj === 'object' && 'id' in obj && name === 'create') {
      const world = args[0]?.value, resource = args[1]?.value as ResourceHandle;
      if (!(world instanceof AssemblyWorld) || !resource || !('id' in resource)) throw new Error('Invalid GameRef.create');
      const definition = world.resources.get(resource.id); if (!('pack' in definition)) throw new Error('Transient cannot be a part type');
      return world.create(definition).value();
    }
    if (receiver.type === 'String' && name === 'floatValue') { const value = Number(obj); if (!Number.isFinite(value)) throw new Error('Invalid string float'); return jv('float', Math.fround(value)); }
    if (obj && typeof obj === 'object' && 'tokens' in obj) {
      const tokenizer = obj as { tokens: string[]; at: number };
      if (name === 'countTokens') return jv('int', tokenizer.tokens.length - tokenizer.at);
      if (name === 'nextToken') { if (tokenizer.at >= tokenizer.tokens.length) throw new Error('StringTokenizer exhausted'); return jv('String', tokenizer.tokens[tokenizer.at++]); }
    }
    if (obj && typeof obj === 'object' && 'tag' in obj && name === 'toString') {
      const record = obj as NativeRecord;
      if (record.tag === 'Vector3' || record.tag === 'Ypr') return jv('String', [...record.fields.values()].map(v => num(v).toFixed(3)).join(','));
    }
    throw new Error(`Missing source/native method ${className ?? receiver.type}.${name}`);
  }
  construct(name: string, args: JavaValue[]) {
    if (name === 'Vector3' || name === 'Ypr') return vector(name, args.map(num));
    if (name === 'StringTokenizer') {
      if (typeof args[0]?.value !== 'string' || typeof args[1]?.value !== 'string' || args[1].value !== ',') throw new Error('Unsupported tokenizer');
      return jv(name, { tokens: args[0].value.split(',').filter(Boolean), at: 0 });
    }
    if (name === 'GameRef' || name === 'ResourceRef') return jv(name, { id: args.length ? num(args[0]) : 0 } satisfies ResourceHandle);
    throw new Error(`Unsupported Java constructor ${name}`);
  }
  private partNative(p: AssemblyPart, name: string, args: JavaValue[]): JavaValue {
    const index = () => num(args[0]) | 0;
    switch (name) {
      case 'getInfo': if (index() !== 6) throw new Error('Only GII_TYPE is available'); return jv('int', p.resourceId);
      case 'id': return jv('int', p.id);
      case 'getParent': return jv('GameRef', p.world);
      case 'getTexture': return jv('int', p.texture);
      case 'getMesh': return jv('int', p.mesh);
      case 'setTexture': p.texture = index(); return nil();
      case 'setMesh': p.mesh = index(); return nil();
      case 'getWear': return jv('float', Math.fround(p.wear));
      case 'getTear': return jv('float', Math.fround(p.tear));
      case 'setWear': p.wear = num(args[0]); return nil();
      case 'setTear': p.tear = num(args[0]); return nil();
      case 'getSlots': return jv('int', p.slots.length);
      case 'getSlotID': { if (index() === -1) return jv('int', p.ownSlot); const slot = p.slots[index()]; if (!slot) throw new Error('Slot index out of range'); return jv('int', slot.id); }
      case 'getSlotDamage': { const slot = p.slots[index()]; if (!slot) throw new Error('Slot index out of range'); return jv('String', slot.damage); }
      case 'setSlotDamage': { const slot = p.slots[index()]; if (!slot) throw new Error('Slot index out of range'); slot.damage = args[1].value as string | null; return nil(); }
      case 'slotIDOnSlot': { const slot = p.slots.find(s => s.id === index()); if (!slot) throw new Error('Slot ID missing'); return jv('int', slot.child ? slot.childSlot : 0); }
      case 'partOnSlot': { const child = p.slots.find(s => s.id === index())?.child; return child?.value() ?? nil(); }
      case 'setSlotPos': {
        if (index() !== p.ownSlot && !p.slots.some(s => s.id === index())) throw new Error('Unknown transform slot');
        if (args[1]?.type !== 'Vector3' || args[2]?.type !== 'Ypr') throw new Error('Invalid slot transform');
        p.slotTransforms.set(index(), { position: copy(args[1]), orientation: copy(args[2]) }); return nil();
      }
      case 'getWheelDamage': if (index() < 0 || index() > 3) throw new Error('Wheel index out of range'); return jv('String', p.wheelDamage[index()]);
      case 'setWheelDamage': if (index() < 0 || index() > 3) throw new Error('Wheel index out of range'); p.wheelDamage[index()] = args[1].value as string | null; return nil();
      case 'getMileage': return jv('float', Math.fround(p.mileage));
      case 'setMileage': p.mileage = num(args[0]); return nil();
      case 'forceUpdate': p.updateCount++; return nil();
      case 'clampTo': return jv('float', Math.fround(Math.max(num(args[1]), Math.min(num(args[2]), num(args[0])))));
      case 'command': {
        if (typeof args[0]?.value !== 'string') throw new Error('Command string expected');
        const tokens = args[0].value.split(/\s+/);
        if (tokens.length !== 6 || tokens[0] !== 'install' || tokens[1] !== '0' || tokens[2] !== tokens[4] || tokens.slice(1).some(t => !/^\d+$/.test(t))) throw new Error('Unsupported part command');
        const parent = p.world.parts.get(Number(tokens[2])); if (!parent) throw new Error('Install parent missing');
        p.world.attach(parent, Number(tokens[5]), p, Number(tokens[3])); return nil();
      }
      default: throw new Error(`Missing part native ${name}`);
    }
  }
}

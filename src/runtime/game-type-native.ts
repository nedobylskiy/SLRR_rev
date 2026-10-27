import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { GameObject, type OrientationState, type Vector3State } from './game-object';
import { ResourceObject } from './resource-object';
import { RenderObject } from './render-object';
import type { ResourceCatalog } from './resource-catalog';
import type { BootEvent } from './game-boot';
import type { ResourceIdentity } from 'slrr-jvm';

const zeroVector = (): Vector3State => ({ x: 0, y: 0, z: 0 });
const zeroOrientation = (): OrientationState => ({ y: 0, p: 0, r: 0 });
const voidValue = () => jv('void', undefined);
export const EVENT_HOTKEY = 0x100000;

interface PendingScriptEvent {
  receiver: JavaValue;
  type: number;
  arguments: JavaValue[];
}

/** Connects interpreted GameRef/GameType methods to one persistent host game object. */
export class GameTypeNative {
  private readonly nodes = new WeakMap<JavaObject, ResourceObject>();
  private readonly objects = new Map<number, ResourceObject>();
  private readonly liveByResourceId = new Map<number, GameObject>();
  private readonly handles = new WeakMap<ResourceObject, JavaValue>();
  private readonly catalogChildrenLoaded = new WeakSet<ResourceObject>();
  private nextId = 1;
  private nextGameResourceId = 0x20000000;
  private nextClonedResourceId = 0x40000000;
  private readonly pendingEvents: PendingScriptEvent[] = [];
  private dispatchingEvents = false;
  private commandHandler?: (receiver: JavaValue, command: string) => void;

  constructor(private readonly jvm: SlrrJvm, private readonly report: (event: BootEvent) => void,
    private readonly renderChanged?: (node: RenderObject) => void,
    private readonly catalog?: ResourceCatalog,
    private readonly instantiateResourceScript?: (script: string, typeId: number, pack: string | null) => Promise<JavaValue>,
    private readonly loadResourcePack?: (pack: string) => Promise<void>,
    private readonly resolvePackedResource?: (id: number) => ResourceIdentity | undefined) {
    const resourceRef = 'java.util.resource.ResourceRef';
    jvm.natives.register(resourceRef, 'newNative', [], ({ receiver }) => {
      this.allocate(receiver); return voidValue();
    });
    jvm.natives.register(resourceRef, 'set', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value) | 0;
      const origin = args[0].resource ?? this.resolvePackedResource?.(id);
      const live = this.liveByResourceId.get(id);
      if (!origin && live instanceof GameObject) {
        const object = this.object(receiver);
        const prior = this.nodes.get(object);
        if (prior && prior !== live) this.objects.delete(prior.id);
        this.nodes.set(object, live);
        return voidValue();
      }
      const node = this.allocate(receiver);
      const resource = origin && this.catalog?.resolve(origin.pack, origin.id);
      node.resourceId = id;
      node.typeId = node.resourceId;
      node.resourceType = resource?.type ?? 0;
      node.resourcePack = resource?.pack ?? (origin?.pack ?? null);
      node.resourceScript = resource?.script ?? null;
      node.alias = resource?.alias ?? node.alias;
      node.copiedFromResourceId = null;
      return voidValue();
    });
    jvm.natives.register(resourceRef, 'set', ['ResourceRef'], ({ receiver, args }) => {
      const literal = args[0].value as { id?: number; pack?: string } | null;
      const source = literal && 'id' in literal && !('fields' in literal) ? null
        : args[0].value == null ? null : this.getResource(args[0]);
      if (source instanceof GameObject) {
        const object = this.object(receiver);
        const prior = this.nodes.get(object);
        if (prior && prior !== source) this.objects.delete(prior.id);
        this.nodes.set(object, source);
        return voidValue();
      }
      const node = this.allocate(receiver);
      node.resourceId = source?.resourceId ?? literal?.id ?? 0;
      node.typeId = source?.typeId ?? node.resourceId;
      node.resourceType = source?.resourceType ?? 0;
      node.resourcePack = source?.resourcePack ?? (typeof literal?.pack === 'string' ? literal.pack : null);
      node.resourceScript = source?.resourceScript ?? null;
      node.copiedFromResourceId = null;
      return voidValue();
    });
    jvm.natives.register(resourceRef, 'duplicate', ['ResourceRef'], ({ receiver, args }) => {
      if (args[0].value == null) return voidValue();
      const source = this.requireResource(args[0]);
      const target = this.allocate(receiver);
      if (source === target) return voidValue();
      target.typeId = source.typeId;
      target.resourceType = source.resourceType;
      target.resourcePack = source.resourcePack;
      target.resourceScript = source.resourceScript;
      target.params = source.params;
      target.alias = source.alias;
      target.setParent(source.parent);
      target.resourceReplacements.clear();
      for (const [before, after] of source.resourceReplacements) target.resourceReplacements.set(before, after);
      target.meshScale = { ...source.meshScale };
      // Clonable resource kinds are 5/7/13/14. Until RPK type lookup exists,
      // an untyped resource is copied so later mutations cannot change its source.
      const cloned = [5, 7, 13, 14].includes(source.resourceType)
        || source.resourceType === 0;
      target.resourceId = cloned ? this.nextClonedResourceId++ : source.resourceId;
      target.copiedFromResourceId = cloned ? source.resourceId : null;
      return voidValue();
    });
    jvm.natives.register(resourceRef, 'scaleMesh', ['float', 'float', 'float'], ({ receiver, args }) => {
      const node = this.requireResource(receiver);
      node.meshScale = { x: node.meshScale.x * Number(args[0].value),
        y: node.meshScale.y * Number(args[1].value), z: node.meshScale.z * Number(args[2].value) };
      return voidValue();
    });
    jvm.natives.register('java.util.resource.RenderRef', 'changeResource', ['ResourceRef', 'ResourceRef'],
      ({ receiver, args }) => {
        const node = this.requireResource(receiver);
        node.resourceReplacements.set(this.resourceId(args[0]), this.resourceId(args[1]));
        return voidValue();
      });
    jvm.natives.register(resourceRef, 'id', [], ({ receiver }) => {
      if (receiver.value == null) return jv('int', 0);
      const literal = receiver.value as { id?: number } | null;
      if (literal && 'id' in literal && !('fields' in literal)) return jv('int', Number(literal.id) | 0);
      return jv('int', this.requireResource(receiver).resourceId);
    });
    jvm.natives.register(resourceRef, 'type', [], ({ receiver }) =>
      jv('int', this.requireResource(receiver).resourceType));
    jvm.natives.register(resourceRef, 'getParentID', [], ({ receiver }) =>
      jv('int', this.requireResource(receiver).parentId ?? 0));
    jvm.natives.register(resourceRef, 'getParent', [], ({ receiver }) =>
      this.handle(this.requireResource(receiver).parent));
    jvm.natives.register(resourceRef, 'getFirstChild', [], ({ receiver }) => {
      const node = this.requireResource(receiver);
      this.materializeCatalogChildren(node);
      return this.handle(node.children.values().next().value ?? null);
    });
    jvm.natives.register(resourceRef, 'getNextChild', [], ({ receiver }) => {
      const node = this.requireResource(receiver);
      if (!node.parent) return jv('ResourceRef', null);
      const siblings = [...node.parent.children];
      return this.handle(siblings[siblings.indexOf(node) + 1] ?? null);
    });
    jvm.natives.register(resourceRef, 'getWTRoot', [], ({ receiver }) => {
      for (let node: ResourceObject | null = this.requireResource(receiver); node; node = node.parent)
        if (node instanceof GameObject && node.worldTreeRoot) return this.handle(node);
      return jv('ResourceRef', null);
    });
    jvm.natives.register(resourceRef, 'destroy', [], ({ receiver }) => {
      const node = this.getResource(receiver);
      if (!node) return voidValue();
      node.setParent(null);
      for (const child of [...node.children]) child.setParent(null);
      this.objects.delete(node.id);
      if (node instanceof GameObject) this.liveByResourceId.delete(node.resourceId);
      this.nodes.delete(this.object(receiver));
      return voidValue();
    });

    const gameType = 'java.lang.GameType';
    jvm.natives.register(gameType, '<init>', [], () => voidValue());
    jvm.natives.register(gameType, 'createNativeInstance', [], ({ receiver }) => this.create(receiver, null, 0, null, null));
    jvm.natives.register(gameType, 'createNativeInstance', ['GameRef'], ({ receiver, args }) => this.create(receiver, args[0], 0, null, null));
    jvm.natives.register(gameType, 'createNativeInstance', ['GameRef', 'int', 'String', 'String'], ({ receiver, args }) =>
      this.create(receiver, args[0], Number(args[1].value), args[2], args[3]));
    jvm.natives.register(gameType, 'setEventMask', ['int'], ({ receiver, args }) => {
      this.require(receiver).setEventMask(Number(args[0].value) | 0); return voidValue();
    });
    jvm.natives.register(gameType, 'clearEventMask', ['int'], ({ receiver, args }) => {
      this.require(receiver).clearEventMask(Number(args[0].value) | 0); return voidValue();
    });

    const gameRef = 'java.util.resource.GameRef';
    const createFromResource = async (receiver: JavaValue, args: readonly JavaValue[]): Promise<JavaValue> => {
      const type = this.getResource(args[1]);
      if (type?.resourcePack && !type.resourceScript && this.loadResourcePack) {
        await this.loadResourcePack(type.resourcePack);
        const resource = this.catalog?.resolve(type.resourcePack, type.typeId);
        if (resource) {
          type.resourceType = resource.type;
          type.resourcePack = resource.pack;
          type.resourceScript = resource.script ?? null;
          type.alias = resource.alias;
        }
      }
      if (type?.resourceScript) {
        if (!this.instantiateResourceScript) throw new Error(`Resource script instantiation missing: ${type.resourceScript}`);
        const scripted = await this.instantiateResourceScript(type.resourceScript, type.typeId, type.resourcePack);
        this.create(scripted, args[0], type.typeId, args[2], args[3]);
        const node = this.require(scripted);
        node.resourcePack = type.resourcePack;
        node.resourceScript = type.resourceScript;
        this.nodes.set(this.object(receiver), node);
        return scripted;
      }
      this.create(receiver, args[0], this.typeId(args[1]), args[2], args[3]);
      return receiver;
    };
    jvm.natives.registerAsync(gameRef, 'create', ['GameRef', 'GameRef', 'String', 'String'],
      ({ receiver, args }) => createFromResource(receiver, args));
    // Build 940 also passes ResourceRef[] elements to the GameRef-typed native factory.
    jvm.natives.registerAsync(gameRef, 'create', ['GameRef', 'ResourceRef', 'String', 'String'],
      ({ receiver, args }) => createFromResource(receiver, args));
    jvm.natives.register(gameRef, 'create_native', ['GameRef', 'GameRef', 'String', 'String'], ({ receiver, args }) =>
      this.create(receiver, args[0], this.typeId(args[1]), args[2], args[3]));
    jvm.natives.register(gameRef, 'getFlags', [], ({ receiver }) => jv('int', this.require(receiver).flags));
    jvm.natives.register(gameRef, 'setFlags', ['int'], ({ receiver, args }) => {
      this.require(receiver).setFlags(Number(args[0].value) | 0); return voidValue();
    });
    jvm.natives.register(gameRef, 'clearFlags', ['int'], ({ receiver, args }) => {
      this.require(receiver).clearFlags(Number(args[0].value) | 0); return voidValue();
    });
    jvm.natives.register(gameRef, 'setParent', ['ResourceRef'], ({ receiver, args }) => {
      this.require(receiver).setParent(args[0].value == null ? null : this.requireResource(args[0])); return voidValue();
    });
    jvm.natives.register(gameRef, 'getPos', [], ({ receiver }) => this.vectorValue(this.require(receiver).position));
    jvm.natives.register(gameRef, 'getOri', [], ({ receiver }) => this.orientationValue(this.require(receiver).orientation));
    jvm.natives.register(gameRef, 'getVel', [], ({ receiver }) => this.vectorValue(this.require(receiver).velocity));
    jvm.natives.register(gameRef, 'getPos', ['Vector3'], ({ receiver, args }) =>
      this.writeVector(args[0], this.require(receiver).position));
    jvm.natives.register(gameRef, 'getOri', ['Ypr'], ({ receiver, args }) =>
      this.writeOrientation(args[0], this.require(receiver).orientation));
    jvm.natives.register(gameRef, 'getVel', ['Vector3'], ({ receiver, args }) =>
      this.writeVector(args[0], this.require(receiver).velocity));
    jvm.natives.register(gameRef, 'setPos', ['Vector3'], ({ receiver, args }) => {
      this.require(receiver).setMatrix(this.readVector(args[0]), zeroOrientation()); return voidValue();
    });
    jvm.natives.register(gameRef, 'setMatrix', ['Vector3', 'Ypr'], ({ receiver, args }) => {
      this.require(receiver).setMatrix(this.readVector(args[0]), this.readOrientation(args[1])); return voidValue();
    });
    jvm.natives.register(gameRef, 'setState', ['Vector3', 'Ypr', 'Vector3', 'Vector3'], ({ receiver, args }) => {
      this.require(receiver).setState(this.readVector(args[0]), this.readOrientation(args[1]),
        this.readVector(args[2]), this.readVector(args[3])); return voidValue();
    });
    jvm.natives.register(gameRef, 'queueEvent', ['ResourceRef', 'int', 'String'], ({ receiver, args }) => {
      const type = Number(args[1].value) | 0;
      if (type === 16 && typeof args[2].value === 'string')
        this.commandHandler?.(receiver, args[2].value);
      this.queueStringEvent(receiver, args[0], type, args[2]);
      return voidValue();
    });
    jvm.natives.register(gameRef, 'setActiveCollision', [], ({ receiver }) => {
      this.require(receiver).requestActiveCollision(); return voidValue();
    });
  }

  get(receiver: JavaValue): GameObject | undefined {
    const node = this.nodes.get(this.object(receiver));
    return node instanceof GameObject ? node : undefined;
  }
  getResource(receiver: JavaValue): ResourceObject | undefined { return this.nodes.get(this.object(receiver)); }
  getRender(receiver: JavaValue): RenderObject | undefined {
    const node = this.getResource(receiver);
    return node instanceof RenderObject ? node : undefined;
  }
  notifyRenderChanged(node: RenderObject): void { this.renderChanged?.(node); }
  createRender(receiver: JavaValue, parent: JavaValue | null, type: JavaValue | null,
    alias: string | null): RenderObject | undefined {
    if (type?.value != null && parent?.value == null) return undefined;
    const object = this.object(receiver);
    const resource = this.allocate(receiver);
    if (resource instanceof RenderObject) throw new Error(`RenderRef instance already exists: ${object.className}`);
    const parentNode = parent?.value == null ? null : this.requireResource(parent);
    const typeNode = type?.value == null ? null : this.requireResource(type);
    const node = new RenderObject(resource.id, object.className, typeNode,
      alias || '_renderinst');
    resource.setParent(null);
    node.setParent(parentNode);
    for (const child of [...resource.children]) child.setParent(node);
    this.nodes.set(object, node);
    this.objects.set(node.id, node);
    this.handles.set(node, receiver);
    this.notifyRenderChanged(node);
    return node;
  }
  getById(id: number): ResourceObject | undefined {
    return this.liveByResourceId.get(id) ?? this.objects.get(id);
  }
  reference(node: ResourceObject | null): JavaValue { return this.handle(node); }
  setCommandHandler(handler: (receiver: JavaValue, command: string) => void): void {
    this.commandHandler = handler;
  }
  roots(): ResourceObject[] { return [...this.objects.values()].filter(node => node.parent === null); }

  queueHotkey(receiver: JavaValue, hotkey: JavaValue): void {
    const node = this.require(receiver);
    node.queueEvent({ sourceId: null, type: EVENT_HOTKEY, payload: null });
    this.pendingEvents.push({ receiver, type: EVENT_HOTKEY, arguments: [hotkey] });
  }

  queueIntEvent(receiver: JavaValue, source: JavaValue, type: number, value: number): void {
    const node = this.require(receiver);
    const sourceNode = source.value == null ? null : this.getResource(source);
    node.queueEvent({ sourceId: sourceNode?.id ?? null, type, payload: value });
    this.pendingEvents.push({ receiver, type, arguments: [source, jv('int', type), jv('int', value)] });
  }

  queueStringEvent(receiver: JavaValue, source: JavaValue, type: number, value: JavaValue): void {
    const node = this.require(receiver);
    const sourceNode = source.value == null ? null : this.getResource(source);
    node.queueEvent({ sourceId: sourceNode?.id ?? null, type,
      payload: value.value == null ? null : String(value.value) });
    this.pendingEvents.push({ receiver, type, arguments: [source, jv('int', type), value] });
  }

  /** Dispatches subscribed events in FIFO order; handlers may enqueue more work. */
  dispatchQueuedEvents(limit = 1000): number {
    if (this.dispatchingEvents) return 0;
    this.dispatchingEvents = true;
    let count = 0;
    try {
      while (this.pendingEvents.length) {
        if (count >= limit) throw new Error('Java event dispatch limit exceeded');
        const event = this.pendingEvents.shift()!;
        const node = this.get(event.receiver);
        if (!node?.acceptsEvent(event.type)) continue;
        this.jvm.invoke(event.receiver, 'handleEvent', event.arguments);
        count++;
      }
      return count;
    } finally { this.dispatchingEvents = false; }
  }

  private require(receiver: JavaValue): GameObject {
    const node = this.get(receiver);
    if (!node) throw new Error(`GameRef has no game object: ${receiver.type}`);
    return node;
  }

  private requireResource(receiver: JavaValue): ResourceObject {
    const node = this.getResource(receiver);
    if (!node) throw new Error(`ResourceRef has no native handle: ${receiver.type}`);
    return node;
  }

  private allocate(receiver: JavaValue): ResourceObject {
    const object = this.object(receiver);
    const current = this.nodes.get(object);
    if (current) return current;
    const node = new ResourceObject(this.nextId++, object.className);
    this.nodes.set(object, node);
    this.objects.set(node.id, node);
    this.handles.set(node, receiver);
    return node;
  }

  private handle(node: ResourceObject | null): JavaValue {
    return node ? this.handles.get(node) ?? jv('ResourceRef', null) : jv('ResourceRef', null);
  }

  private materializeCatalogChildren(parent: ResourceObject): void {
    if (!this.catalog || !parent.resourcePack || this.catalogChildrenLoaded.has(parent)) return;
    this.catalogChildrenLoaded.add(parent);
    for (const child of this.catalog.childrenOf(parent.resourcePack, parent.resourceId)) {
      const receiver = this.jvm.construct('java.util.resource.ResourceRef',
        [jv('ResourceRef', { pack: child.pack, id: child.id })]);
      const node = this.requireResource(receiver);
      node.resourceType = child.type;
      node.resourceScript = child.script ?? null;
      node.alias = child.alias;
      node.setParent(parent);
    }
  }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`GameType native receiver is not a Java object: ${receiver.type}`);
    return object;
  }

  private typeId(value: JavaValue): number {
    if (value.value == null) return 0;
    const raw = value.value;
    if (typeof raw === 'object' && 'id' in raw && !('fields' in raw)) return Number(raw.id) | 0;
    return (this.getResource(value)?.typeId ?? Number(this.jvm.get(value, 'typeID').value)) | 0;
  }

  private resourceId(value: JavaValue): number {
    if (value.value == null) return 0;
    const raw = value.value;
    if (typeof raw === 'object' && 'id' in raw && !('fields' in raw)) return Number(raw.id) | 0;
    return this.requireResource(value).resourceId;
  }

  private readNumber(value: JavaValue, field: string): number {
    const number = Number(this.jvm.get(value, field).value);
    if (!Number.isFinite(number)) throw new Error(`Invalid ${value.type}.${field}`);
    return number;
  }

  private readVector(value: JavaValue): Vector3State {
    if (value.value == null) return zeroVector();
    return { x: this.readNumber(value, 'x'), y: this.readNumber(value, 'y'), z: this.readNumber(value, 'z') };
  }

  private readOrientation(value: JavaValue): OrientationState {
    if (value.value == null) return zeroOrientation();
    return { y: this.readNumber(value, 'y'), p: this.readNumber(value, 'p'), r: this.readNumber(value, 'r') };
  }

  private vectorValue(vector: Vector3State): JavaValue {
    return jv('Vector3', { className: 'java.lang.Vector3', fields: new Map(Object.entries(vector)
      .map(([name, value]) => [name, jv('float', value)])) });
  }

  private orientationValue(orientation: OrientationState): JavaValue {
    return jv('Ypr', { className: 'java.lang.Ypr', fields: new Map(Object.entries(orientation)
      .map(([name, value]) => [name, jv('float', value)])) });
  }

  private writeVector(target: JavaValue, vector: Vector3State): JavaValue {
    for (const key of ['x', 'y', 'z'] as const) this.jvm.set(target, key, jv('float', vector[key]));
    return target;
  }

  private writeOrientation(target: JavaValue, orientation: OrientationState): JavaValue {
    for (const key of ['y', 'p', 'r'] as const) this.jvm.set(target, key, jv('float', orientation[key]));
    return target;
  }

  private create(receiver: JavaValue, parent: JavaValue | null, typeId: number,
    params: JavaValue | null, alias: JavaValue | null): JavaValue {
    const object = this.object(receiver);
    const resource = this.allocate(receiver);
    if (resource instanceof GameObject) throw new Error(`GameType native instance already exists: ${object.className}`);
    // A Java-only parent such as Init has no native handle; the original factory uses the world root.
    const parentNode = parent?.value == null ? null : this.getResource(parent) ?? null;
    if (!Number.isInteger(typeId) || typeId < 0) throw new Error(`Invalid GameType type ID: ${typeId}`);
    const node = new GameObject(resource.id, object.className, typeId,
      params?.value == null ? null : String(params.value),
      alias?.value == null ? object.className.split('.').at(-1)! : String(alias.value));
    node.resourceId = this.nextGameResourceId++;
    node.resourceType = 1;
    resource.setParent(null);
    node.setParent(parentNode);
    for (const child of [...resource.children]) child.setParent(node);
    this.nodes.set(object, node);
    this.objects.set(node.id, node);
    this.liveByResourceId.set(node.resourceId, node);
    this.handles.set(node, receiver);
    this.report({ level: 'native', message: `GameType instance #${node.id}: ${node.className} (parent ${node.parentId ?? 'root'}, type ${node.typeId})` });
    return voidValue();
  }
}

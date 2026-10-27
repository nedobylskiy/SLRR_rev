import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { GameObject, type OrientationState, type Vector3State } from './game-object';
import { ResourceObject } from './resource-object';
import type { BootEvent } from './game-boot';

const zeroVector = (): Vector3State => ({ x: 0, y: 0, z: 0 });
const zeroOrientation = (): OrientationState => ({ y: 0, p: 0, r: 0 });
const voidValue = () => jv('void', undefined);

/** Connects interpreted GameRef/GameType methods to one persistent host game object. */
export class GameTypeNative {
  private readonly nodes = new WeakMap<JavaObject, ResourceObject>();
  private readonly objects = new Map<number, ResourceObject>();
  private readonly handles = new WeakMap<ResourceObject, JavaValue>();
  private nextId = 1;

  constructor(private readonly jvm: SlrrJvm, private readonly report: (event: BootEvent) => void) {
    const resourceRef = 'java.util.resource.ResourceRef';
    jvm.natives.register(resourceRef, 'newNative', [], ({ receiver }) => {
      this.allocate(receiver); return voidValue();
    });
    jvm.natives.register(resourceRef, 'set', ['int'], ({ receiver, args }) => {
      const node = this.allocate(receiver);
      node.resourceId = Number(args[0].value) | 0;
      node.typeId = node.resourceId;
      return voidValue();
    });
    jvm.natives.register(resourceRef, 'set', ['ResourceRef'], ({ receiver, args }) => {
      const node = this.allocate(receiver);
      const literal = args[0].value as { id?: number } | null;
      const source = literal && 'id' in literal && !('fields' in literal) ? null
        : args[0].value == null ? null : this.getResource(args[0]);
      node.resourceId = source?.resourceId ?? literal?.id ?? 0;
      node.typeId = source?.typeId ?? node.resourceId;
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
    jvm.natives.register(resourceRef, 'getFirstChild', [], ({ receiver }) =>
      this.handle(this.requireResource(receiver).children.values().next().value ?? null));
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

    const gameType = 'java.lang.GameType';
    jvm.natives.register(gameType, '<init>', [], () => voidValue());
    jvm.natives.register(gameType, 'createNativeInstance', [], ({ receiver }) => this.create(receiver, null, 0, null, null));
    jvm.natives.register(gameType, 'createNativeInstance', ['GameRef'], ({ receiver, args }) => this.create(receiver, args[0], 0, null, null));
    jvm.natives.register(gameType, 'createNativeInstance', ['GameRef', 'int', 'String', 'String'], ({ receiver, args }) =>
      this.create(receiver, args[0], Number(args[1].value), args[2], args[3]));

    const gameRef = 'java.util.resource.GameRef';
    jvm.natives.register(gameRef, 'create', ['GameRef', 'GameRef', 'String', 'String'], ({ receiver, args }) => {
      this.create(receiver, args[0], this.typeId(args[1]), args[2], args[3]);
      return receiver;
    });
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
      const source = args[0].value == null ? null : this.getResource(args[0]);
      this.require(receiver).queueEvent({ sourceId: source?.id ?? null, type: Number(args[1].value) | 0,
        payload: args[2].value == null ? null : String(args[2].value) });
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
  getById(id: number): ResourceObject | undefined { return this.objects.get(id); }
  roots(): ResourceObject[] { return [...this.objects.values()].filter(node => node.parent === null); }

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
    node.resourceId = node.id;
    node.resourceType = 1;
    resource.setParent(null);
    node.setParent(parentNode);
    for (const child of [...resource.children]) child.setParent(node);
    this.nodes.set(object, node);
    this.objects.set(node.id, node);
    this.handles.set(node, receiver);
    this.report({ level: 'native', message: `GameType instance #${node.id}: ${node.className} (parent ${node.parentId ?? 'root'}, type ${node.typeId})` });
    return voidValue();
  }
}

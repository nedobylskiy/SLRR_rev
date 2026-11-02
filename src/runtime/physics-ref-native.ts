import { Matrix4, Vector3 } from 'three';
import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { poseMatrix } from '../engine/transforms';
import type { MapCollision } from '../engine/map-collision';
import type { ResourceObject } from './resource-object';
import { GameObject, type OrientationState, type Vector3State } from './game-object';
import type { GameTypeNative } from './game-type-native';

interface PhysicsBox {
  receiver: JavaValue; node: ResourceObject; half: Vector3;
  position: Vector3State; orientation: OrientationState;
}
const voidValue = () => jv('void', undefined);

/** Script-created world colliders. OSD hit boxes are routed separately by OsdButtonNative. */
export class PhysicsRefNative {
  private readonly boxes = new Map<ResourceObject, PhysicsBox>();
  private readonly bindings = new Set<() => void>();

  constructor(private readonly jvm: SlrrJvm, private readonly resources: GameTypeNative) {
    const owner = 'java.util.resource.PhysicsRef';
    jvm.natives.register(owner, 'getOri', [], ({ receiver }) => this.vector('Ypr', this.require(receiver).orientation));
    // These script-created boxes are fixed obstacles, moved explicitly by setMatrix.
    // Dynamic rigid-body integration for standalone PhysicsRefs is not hosted yet.
    jvm.natives.register(owner, 'setStatic', ['int'], ({ receiver, args }) => {
      this.require(receiver);
      if (!Number(args[0].value)) throw new Error('Dynamic standalone PhysicsRef bodies are not implemented');
      return voidValue();
    });
    jvm.natives.register(owner, 'getVel', [], ({ receiver }) => {
      this.require(receiver); return this.vector('Vector3', { x: 0, y: 0, z: 0 });
    });
    jvm.natives.register(owner, 'getAngVel', [], ({ receiver }) => {
      this.require(receiver); return this.vector('Vector3', { x: 0, y: 0, z: 0 });
    });
    jvm.natives.register(owner, 'destroy', [], ({ receiver }) => {
      const node = receiver.value == null ? undefined : resources.getResource(receiver);
      if (node) this.boxes.delete(node);
      jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', receiver, []);
      this.sync(); return voidValue();
    });
  }

  createBox(receiver: JavaValue, args: readonly JavaValue[]): JavaValue {
    let node = this.resources.getResource(receiver);
    const parent = args[0].value == null ? undefined : this.resources.getResource(args[0]);
    if (!parent) throw new Error('PhysicsRef.createBox parent has no native handle');
    const dimensions = args.slice(1, 4).map(value => Number(value.value));
    if (!dimensions.every(value => Number.isFinite(value) && value > 0)) throw new Error('PhysicsRef.createBox requires positive finite dimensions');
    // Garage keeps its PhysicsRef field across exit()/enter(): destroy removes
    // the body, while createBox recreates it on the same live Java wrapper.
    if (!node) {
      this.jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', receiver, []);
      node = this.resources.getResource(receiver);
    }
    if (!node) throw new Error('PhysicsRef.createBox could not allocate a native box handle');
    for (const [old, box] of this.boxes)
      if (old !== node && box.receiver.value === receiver.value) this.boxes.delete(old);
    node.setParent(parent);
    node.resourceId = 0x30000000 + node.id;
    node.resourceType = 2; // INSTANCE_PHYSICS
    node.alias = String(args[4].value ?? 'physics_box');
    this.boxes.set(node, { receiver, node, half: new Vector3(...dimensions).multiplyScalar(0.5),
      position: { x: 0, y: 0, z: 0 }, orientation: { y: 0, p: 0, r: 0 } });
    this.sync(); return voidValue();
  }

  setMatrix(receiver: JavaValue, position: JavaValue, orientation: JavaValue): JavaValue {
    const box = this.require(receiver);
    const nextPosition = this.read(position, ['x', 'y', 'z']);
    const nextOrientation = this.read(orientation, ['y', 'p', 'r']);
    box.position = nextPosition;
    box.orientation = nextOrientation;
    this.sync(); return voidValue();
  }

  getPos(receiver: JavaValue): JavaValue { return this.vector('Vector3', this.require(receiver).position); }

  /** Bind only this map's Java colliders; refresh before physics to catch parent pose/ownership changes. */
  bindCollision(map: JavaValue, collision: MapCollision): { sync(): void; dispose(): void } {
    const root = this.resources.getResource(map);
    if (!root) throw new Error('PhysicsRef collision binding requires a map handle');
    const installed = new Map<ResourceObject, { matrix: Matrix4; half: Vector3; remove(): void }>();
    let disposed = false;
    const sync = () => {
      if (disposed) return;
      const wanted = new Set<ResourceObject>();
      for (const [node, box] of this.boxes) {
        if (this.resources.getResource(box.receiver) !== node) continue;
        const ancestors: ResourceObject[] = [];
        for (let parent = node.parent; parent; parent = parent.parent) ancestors.push(parent);
        if (!ancestors.includes(root)) continue;
        wanted.add(node);
        const matrix = new Matrix4();
        for (const ancestor of ancestors.reverse()) {
          const pose = this.boxes.get(ancestor) ?? (ancestor instanceof GameObject ? ancestor : undefined);
          if (pose) matrix.multiply(this.matrix(pose));
        }
        matrix.multiply(this.matrix(box));
        const old = installed.get(node);
        if (old?.matrix.equals(matrix) && old.half.equals(box.half)) continue;
        old?.remove();
        installed.set(node, { matrix, half: box.half.clone(), remove: collision.addBox(matrix, box.half) });
      }
      for (const [node, old] of installed) if (!wanted.has(node)) { old.remove(); installed.delete(node); }
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true; this.bindings.delete(sync);
      for (const old of installed.values()) old.remove();
      installed.clear();
    };
    this.bindings.add(sync); sync();
    return { sync, dispose };
  }

  private sync(): void { for (const sync of this.bindings) sync(); }
  private matrix(pose: { position: Vector3State; orientation: OrientationState }): Matrix4 {
    return poseMatrix({ position: [pose.position.x, pose.position.y, pose.position.z],
      rotation: [pose.orientation.y, pose.orientation.p, pose.orientation.r] });
  }
  private require(receiver: JavaValue): PhysicsBox {
    const node = this.resources.getResource(receiver), box = node && this.boxes.get(node);
    if (!box) throw new Error('PhysicsRef has no world box');
    return box;
  }
  private read<K extends string>(value: JavaValue, fields: K[]): Record<K, number> {
    const result = Object.fromEntries(fields.map(field => [field, value.value == null ? 0 : Number(this.jvm.get(value, field).value)])) as Record<K, number>;
    if (!Object.values(result).every(Number.isFinite)) throw new Error('PhysicsRef.setMatrix requires a finite pose');
    return result;
  }
  private vector(type: string, value: Vector3State | OrientationState): JavaValue {
    return jv(type, { className: `java.lang.${type}`, fields: new Map(Object.entries(value).map(([axis, number]) => [axis, jv('float', number)])) } satisfies JavaObject);
  }
  dispose(): void { this.boxes.clear(); this.sync(); this.bindings.clear(); }
}

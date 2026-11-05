import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { ResourceObject } from './resource-object';
import type { PartConfig, CfgSlot } from '../formats/cfg';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { slotMatrix } from '../engine/slot-frames';

interface InstalledSlot { child: ResourceObject; mate: number }
interface PartSlots {
  slots: CfgSlot[];
  installed: Map<number, InstalledSlot>;
  disabled: Set<number>;
  parentSlot: number;
  ownSlot: number;
  positions: Map<number, { position?: [number, number, number]; rotation?: [number, number, number] }>;
}

export interface NativeInstalledPart {
  node: ResourceObject;
  parentSlot: number;
  ownSlot: number;
  positions: ReadonlyMap<number, { position?: [number, number, number]; rotation?: [number, number, number] }>;
  renderType?: number;
  texture?: JavaValue;
  wear: number;
  children: NativeInstalledPart[];
}

/** Native condition values owned by each interpreted SLRR part. */
export class PartNative {
  private readonly maxWear = new WeakMap<JavaObject, number>();
  private readonly wear = new WeakMap<JavaObject, number>();
  private readonly tear = new WeakMap<JavaObject, number>();
  private readonly texture = new WeakMap<JavaObject, JavaValue>();
  private readonly mesh = new WeakMap<JavaObject, JavaValue>();
  private readonly slotDamage = new WeakMap<JavaObject, Map<number, string>>();
  private readonly renderType = new WeakMap<JavaObject, number>();
  private readonly slots = new WeakMap<ResourceObject, PartSlots>();
  private readonly configs = new WeakMap<JavaObject, PartConfig | null>();

  constructor(private readonly jvm: SlrrJvm, private readonly gameTypes: GameTypeNative,
    private readonly compatibleSlots?: (parent: ResourceObject, parentSlot: CfgSlot,
      child: ResourceObject, childSlot: CfgSlot) => Promise<boolean>) {
    const owner = 'java.game.parts.Part';
    gameTypes.setCommandHandler((receiver, command) => this.command(receiver, command));
    gameTypes.setObjectCategoryReader(receiver => {
      const node = gameTypes.getResource(receiver);
      const canonical = node && gameTypes.reference(node);
      const config = this.configs.get(receiver.value as JavaObject)
        ?? (canonical && this.configs.get(canonical.value as JavaObject));
      // Native car bodies own the wheel definitions. Other configured parts
      // remain GIR_CAT_PART regardless of their body/engine/running-gear filter.
      return config ? config.wheels.length ? 5 : 9 : 0;
    });
    gameTypes.setPartCategoryReader(receiver => {
      const node = gameTypes.getResource(receiver);
      const canonical = node && gameTypes.reference(node);
      return this.configs.get(receiver.value as JavaObject)?.category
        ?? (canonical && this.configs.get(canonical.value as JavaObject)?.category) ?? 0;
    });
    gameTypes.setPartCompatibilityReader((receiver, target, installable) => this.compatibility(receiver, target, installable));
    gameTypes.setRemovalReader(receiver => {
      const child = gameTypes.getResource(receiver);
      if (!child?.parent) return -1;
      const state = this.partSlots(gameTypes.reference(child));
      const parent = this.partSlots(gameTypes.reference(child.parent));
      return state.parentSlot && !parent.disabled.has(state.parentSlot) ? 0 : -1;
    });
    jvm.natives.registerAsync(owner, 'install_OK', ['GameRef','int','GameRef','int','Vector3'], async ({receiver,args}) => {
      const child = gameTypes.getResource(receiver), root = gameTypes.getResource(args[0]);
      if (!child || !root || child === root) return jv('int[]',null);
      const ownId = Number(args[1].value), targetId = Number(args[3].value);
      const ownSlots = this.partSlots(gameTypes.reference(child)).slots;
      const preferred = args[4].value == null ? undefined : new Vector3(...['x','y','z'].map(axis => Number(jvm.get(args[4],axis).value)) as [number,number,number]);
      let best: {node: ResourceObject; own: number; slot: number; distance: number} | undefined;
      const visit = async (parent: ResourceObject): Promise<void> => {
        if (parent === child) return;
        const state = this.partSlots(gameTypes.reference(parent));
        for (const slot of state.slots) {
          if (targetId && targetId !== slot.id || state.disabled.has(slot.id) || state.installed.has(slot.id)) continue;
          for (const own of ownSlots) {
            if (ownId && own.id !== ownId || !await this.matches(parent,slot,child,own)) continue;
            const distance = preferred ? new Vector3(...slot.position).distanceToSquared(preferred) : 0;
            if (!best || distance < best.distance) best = {node:parent,own:own.id,slot:slot.id,distance};
          }
        }
        for (const nested of state.installed.values()) await visit(nested.child);
      };
      await visit(root);
      if (!best) return jv('int[]',null);
      if (args[2].value != null) jvm.natives.invoke('java.util.resource.ResourceRef','set',args[2],[jv('ResourceRef',gameTypes.reference(best.node).value)]);
      return jv('int[]',[best.own,best.slot]);
    });
    jvm.natives.register(owner, 'getSlots', [], ({ receiver }) =>
      jv('int', this.partSlots(receiver).slots.length));
    jvm.natives.register(owner, 'getSlotID', ['int'], ({ receiver, args }) => {
      const index = Number(args[0].value);
      const state = this.partSlots(receiver);
      return jv('int', index === -1 ? state.ownSlot : state.slots[index]?.id ?? 0);
    });
    jvm.natives.register(owner, 'partOnSlot', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value) | 0;
      const state = this.partSlots(receiver);
      const node = this.gameTypes.getResource(receiver)!;
      if (id === -1) return receiver;
      if (id === state.ownSlot && state.parentSlot && node.parent)
        return this.gameTypes.reference(node.parent);
      return this.gameTypes.reference(state.installed.get(id)?.child ?? null);
    });
    jvm.natives.register(owner, 'slotIDOnSlot', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value) | 0;
      const state = this.partSlots(receiver);
      return jv('int', id === state.ownSlot && state.parentSlot ? state.parentSlot
        : state.installed.get(id)?.mate ?? 0);
    });
    jvm.natives.register(owner, 'getCarRef', [], ({ receiver }) =>
      this.gameTypes.reference(this.carNode(receiver)));
    jvm.natives.register(owner, 'getMass', [], ({ receiver }) =>
      jv('float', Math.fround(this.partMass(receiver))));
    jvm.natives.register('java.game.parts.bodypart.Chassis', 'getMass', [], ({ receiver }) =>
      jv('float', Math.fround(this.assemblyMass(receiver))));
    jvm.natives.register('java.game.parts.bodypart.Chassis', 'getCM', [], ({ receiver }) => {
      const center = this.assemblyCenterOfMass(receiver);
      return jv('Vector3', { className: 'java.lang.Vector3', fields: new Map(
        ['x', 'y', 'z'].map((axis, index) => [axis, jv('float', Math.fround(center.getComponent(index)))])
      ) } satisfies JavaObject);
    });
    jvm.natives.register(owner, 'getWheelID', [], ({ receiver }) => {
      const car = this.carNode(receiver);
      let node = this.gameTypes.getResource(receiver);
      while (car && node && node.parent && node.parent !== car) node = node.parent;
      const slot = node && node.parent === car
        ? this.partSlots(this.gameTypes.reference(node)).parentSlot : 0;
      return jv('int', slot > 100 && slot <= 400 ? (slot - 101) % 10 : -1);
    });
    jvm.natives.register(owner, 'disableSlot', ['int', 'int'], ({ receiver, args }) => {
      const state = this.partSlots(receiver);
      const id = Number(args[0].value) | 0;
      if (Number(args[1].value)) state.disabled.add(id);
      else state.disabled.delete(id);
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'setSlotPos', ['int', 'Vector3', 'Ypr'], ({ receiver, args }) => {
      const state = this.partSlots(receiver), id = Number(args[0].value) | 0;
      const read = (value: JavaValue, names: [string, string, string]) => value.value == null ? undefined
        : names.map(name => Number(this.jvm.get(value, name).value)) as [number, number, number];
      const position = read(args[1], ['x', 'y', 'z']);
      const rotation = read(args[2], ['y', 'p', 'r']);
      if ([...(position ?? []), ...(rotation ?? [])].some(value => !Number.isFinite(value)))
        throw new Error('Invalid part slot position');
      const slot = state.slots.find(slot => slot.id === id);
      // Part.load passes the saved drag offset, not an absolute CFG mount.
      // Reset to the prototype on every call so repeated loads cannot accumulate it.
      const adjustedRotation = slot && rotation ? new Euler().setFromQuaternion(
        new Quaternion().setFromEuler(new Euler(slot.rotation[1], slot.rotation[0], slot.rotation[2], 'YXZ'))
          .multiply(new Quaternion().setFromEuler(new Euler(rotation[1], rotation[0], rotation[2], 'YXZ'))), 'YXZ') : undefined;
      if (slot) state.positions.set(id, {
        position: position ? slot.position.map((base, axis) => base + position[axis]) as [number, number, number] : undefined,
        rotation: adjustedRotation ? [adjustedRotation.y, adjustedRotation.x, adjustedRotation.z] : undefined,
      });
      return jv('void', undefined);
    });
    // Some stock part resources have no script binding and GameRef.create returns a
    // GameRef. Keep their condition on the same resource while Java assembles the car.
    for (const conditionOwner of [owner, 'java.util.resource.GameRef']) {
      jvm.natives.register(conditionOwner, 'getWear', [], ({ receiver }) =>
        jv('float', this.wear.get(receiver.value as JavaObject) ?? 1));
      jvm.natives.register(conditionOwner, 'setWear', ['float'], ({ receiver, args }) => {
        const value = Math.fround(Number(args[0].value));
        if (!Number.isFinite(value)) throw new Error('Invalid part wear');
        this.wear.set(receiver.value as JavaObject, value);
        return jv('float', value);
      });
      jvm.natives.register(conditionOwner, 'getTear', [], ({receiver}) =>
        jv('float',this.tear.get(receiver.value as JavaObject) ?? 1));
      jvm.natives.register(conditionOwner, 'setTear', ['float'], ({receiver,args}) => {
        const value=Math.fround(Number(args[0].value));
        if (!Number.isFinite(value)) throw new Error('Invalid part tear');
        this.tear.set(receiver.value as JavaObject,value);
        return jv('float',value);
      });
    }
    jvm.natives.register(owner, 'setMaxWear', ['float'], ({ receiver, args }) => {
      const limit = Number(args[0].value);
      if (!Number.isFinite(limit) || limit < 0) throw new Error('Invalid part maximum wear');
      this.maxWear.set(receiver.value as JavaObject, limit);
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'getTexture', [], ({ receiver }) =>
      this.texture.get(receiver.value as JavaObject) ?? jv('int', 0));
    // The mesh binding is seeded from the CFG's mesh directive and may be
    // replaced per instance. It is distinct from the CFG render resource ID.
    jvm.natives.register(owner, 'getMesh', [], ({ receiver }) =>
      this.mesh.get(receiver.value as JavaObject) ?? jv('int', 0));
    jvm.natives.register(owner, 'setMesh', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value);
      if (!Number.isInteger(id)) throw new Error('Invalid part mesh resource ID');
      this.mesh.set(receiver.value as JavaObject, { ...args[0], type: 'int', value: id | 0 });
      return jv('int', 1);
    });
    jvm.natives.register(owner, 'getSlotDamage', ['int'], ({ receiver, args }) =>
      jv('String', this.slotDamage.get(receiver.value as JavaObject)?.get(Number(args[0].value)) ?? null));
    jvm.natives.register(owner, 'setSlotDamage', ['int', 'String'], ({ receiver, args }) => {
      const object = receiver.value as JavaObject;
      const damage = this.slotDamage.get(object) ?? new Map<number, string>();
      const index = Number(args[0].value);
      if (!Number.isInteger(index) || index < 0) throw new Error('Invalid part slot damage index');
      if (args[1].value == null) damage.delete(index);
      else damage.set(index, String(args[1].value));
      this.slotDamage.set(object, damage);
      // Stored opaque data for original Part.save/load; applying slot damage
      // to live physical attachment strength is not implemented yet.
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'setTexture', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value);
      if (!Number.isInteger(id)) throw new Error('Invalid part texture resource ID');
      this.texture.set(receiver.value as JavaObject, { ...args[0], type: 'int', value: id | 0 });
      // The original native reports success even when no render object is bound yet.
      return jv('int', 1);
    });
    jvm.natives.register(owner, 'setRenderType', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value);
      if (!Number.isInteger(id)) throw new Error('Invalid part render type');
      this.renderType.set(receiver.value as JavaObject, id);
      return jv('int', 1);
    });
    jvm.natives.register(owner, 'getCar', [], ({ receiver }) => {
      return jv('int', this.carNode(receiver)?.resourceId ?? 0);
    });
  }

  configure(receiver: JavaValue, cfg: PartConfig | null): void {
    this.configs.set(receiver.value as JavaObject, cfg);
    const node = this.gameTypes.getResource(receiver);
    const state = node && this.slots.get(node);
    if (state) state.slots = cfg?.slots ?? [];
  }

  cameraCount(receiver: JavaValue): number {
    const object = receiver.value as JavaObject | null;
    if (!object) return 0;
    const chassis = object.fields.get('chassis')?.value as JavaObject | null | undefined;
    if (chassis) {
      const count = this.configs.get(chassis)?.cameras.length;
      if (count !== undefined) return count;
    }
    const root = this.gameTypes.getResource(receiver);
    if (!root) return 0;
    const visit = (node: ResourceObject): number => {
      const handle = this.gameTypes.reference(node);
      const count = handle.value == null ? 0 : this.configs.get(handle.value as JavaObject)?.cameras.length ?? 0;
      if (count) return count;
      for (const child of node.children) {
        const nested = visit(child);
        if (nested) return nested;
      }
      return 0;
    };
    return visit(root);
  }

  slotOverrides(receiver: JavaValue): ReadonlyMap<number, { position?: [number, number, number]; rotation?: [number, number, number] }> {
    return this.partSlots(receiver).positions;
  }
  renderTypeFor(receiver: JavaValue): number | undefined { return this.renderType.get(receiver.value as JavaObject); }
  textureFor(receiver: JavaValue): JavaValue | undefined { return this.texture.get(receiver.value as JavaObject); }

  installedTree(receiver: JavaValue): NativeInstalledPart[] {
    const root = this.gameTypes.getResource(receiver);
    if (!root) throw new Error('Java chassis has no native resource');
    const visited = new Set<ResourceObject>([root]);
    const children = (parent: ResourceObject): NativeInstalledPart[] => {
      const state = this.partSlots(this.gameTypes.reference(parent));
      return [...state.installed].map(([parentSlot, { child, mate }]) => {
        if (visited.has(child) || child.parent !== parent) throw new Error('Invalid Java installed part tree');
        visited.add(child);
        const handle = this.gameTypes.reference(child), object = handle.value as JavaObject;
        const childState = this.partSlots(handle);
        return { node: child, parentSlot, ownSlot: mate, positions: childState.positions,
          renderType: this.renderType.get(object), texture: this.texture.get(object), wear: this.wear.get(object) ?? 1,
          children: children(child) };
      });
    };
    return children(root);
  }

  partMass(receiver: JavaValue): number {
    return this.configs.get(receiver.value as JavaObject)?.bodies.reduce((total, body) => total + body.mass, 0) ?? 0;
  }

  assemblyMass(receiver: JavaValue): number {
    const root = this.gameTypes.getResource(receiver);
    if (!root) return 0;
    const visited = new Set<ResourceObject>();
    const visit = (node: ResourceObject): number => {
      if (visited.has(node)) throw new Error('Part installation cycle in mass calculation');
      visited.add(node);
      const handle = this.gameTypes.reference(node);
      const state = this.partSlots(handle);
      return this.partMass(handle) + [...state.installed.values()].reduce((sum, installed) =>
        sum + visit(installed.child), 0);
    };
    return visit(root);
  }

  /** CFG body centers transformed through installed slot frames, relative to the chassis. */
  assemblyCenterOfMass(receiver: JavaValue): Vector3 {
    const root = this.gameTypes.getResource(receiver), weighted = new Vector3();
    if (!root) return weighted;
    let mass = 0;
    const visited = new Set<ResourceObject>();
    const frame = (config: PartConfig, state: PartSlots, id: number): Matrix4 => {
      const slot = state.slots.find(slot => slot.id === id);
      if (!slot) throw new Error(`Missing installed part slot ${id} in center of mass calculation`);
      const override = state.positions.get(id);
      return slotMatrix(config, { ...slot, position: override?.position ?? slot.position,
        rotation: override?.rotation ?? slot.rotation });
    };
    const visit = (node: ResourceObject, transform: Matrix4): void => {
      if (visited.has(node)) throw new Error('Part installation cycle in center of mass calculation');
      visited.add(node);
      const handle = this.gameTypes.reference(node), config = this.configs.get(handle.value as JavaObject);
      const state = this.partSlots(handle);
      for (const body of config?.bodies ?? []) {
        if (body.mass <= 0) continue;
        weighted.addScaledVector(new Vector3(...body.position).applyMatrix4(transform), body.mass);
        mass += body.mass;
      }
      for (const [id, installed] of state.installed) {
        const childHandle = this.gameTypes.reference(installed.child);
        const childConfig = this.configs.get(childHandle.value as JavaObject);
        if (!config || !childConfig) throw new Error('Installed part CFG missing in center of mass calculation');
        const childTransform = transform.clone().multiply(frame(config, state, id))
          .multiply(frame(childConfig, this.partSlots(childHandle), installed.mate).invert());
        visit(installed.child, childTransform);
      }
    };
    visit(root, new Matrix4());
    return mass > 0 ? weighted.divideScalar(mass) : weighted;
  }

  private partSlots(receiver: JavaValue): PartSlots {
    const node = this.gameTypes.getResource(receiver);
    if (!node) throw new Error('Part has no native game object');
    let state = this.slots.get(node);
    if (!state) {
      state = { slots: this.configs.get(receiver.value as JavaObject)?.slots ?? [],
        installed: new Map(), disabled: new Set(), parentSlot: 0, ownSlot: 0, positions: new Map() };
      this.slots.set(node, state);
    }
    return state;
  }

  /** The engine's native table is owned by the installed Java Block, not Chassis. */
  engineDyno(receiver: JavaValue): JavaValue | undefined {
    for (const installed of this.installedTree(receiver)) {
      const handle = this.gameTypes.reference(installed.node);
      if (this.jvm.isInstance(handle,'java.game.parts.enginepart.Block'))
        return (handle.value as JavaObject).fields.get('dynodata');
    }
    return undefined;
  }

  private carNode(receiver: JavaValue): ResourceObject | null {
    for (let node: ResourceObject | null | undefined = this.gameTypes.get(receiver); node; node = node.parent) {
      for (let className: string | null = node.className; className; className = this.jvm.parent(className))
        if (className === 'java.game.parts.bodypart.Chassis') return node;
    }
    return null;
  }

  private async command(receiver: JavaValue, command: string): Promise<void> {
    const words = command.trim().split(/\s+/);
    // Vehicle.wakeUp and the garage lift's reset follow inventory edits. Run
    // Java's recalculation here so disableSlot reflects the current assembly,
    // rather than the assembly it had when the vehicle was first created.
    if (words[0] === 'wakeup' || words[0] === 'reset') {
      const root = this.gameTypes.getResource(receiver);
      const car = this.carNode(receiver) ?? [...root?.children ?? []].find(node =>
        this.carNode(this.gameTypes.reference(node)) === node);
      if (car) await this.jvm.natives.invokeAsync('java.game.parts.bodypart.Chassis', 'forceUpdate',
        this.gameTypes.reference(car), []);
      return;
    }
    if (words[0] === 'remove') {
      if (words.length !== 3 || words.slice(1).some(word => !/^\d+$/.test(word))) throw new Error(`Invalid part remove command: ${command}`);
      const child = this.gameTypes.getResource(receiver);
      if (!child) return;
      const state = this.partSlots(receiver), parent = child.parent;
      const car = this.carNode(receiver);
      if (!parent || !state.parentSlot) return;
      const handle = this.gameTypes.reference(child), object = handle.value as JavaObject;
      if (object.fields.has('attachedParts')) await this.jvm.invokeAsync(handle, 'remove');
      if (car && (this.gameTypes.reference(car).value as JavaObject).fields.has('attachedParts')) {
        const notify = async (part: ResourceObject): Promise<void> => {
          const ref = this.gameTypes.reference(part);
          if ((ref.value as JavaObject).fields.has('attachedParts')) await this.jvm.invokeAsync(this.gameTypes.reference(car), 'rempart', [ref]);
          for (const nested of part.children) await notify(nested);
        };
        await notify(child);
      }
      this.partSlots(this.gameTypes.reference(parent)).installed.delete(state.parentSlot);
      state.parentSlot = state.ownSlot = 0;
      const destination = this.gameTypes.getByResourceId(Number(words[2])) ?? this.gameTypes.getById(Number(words[2]));
      child.setParent(destination ?? null);
      return;
    }
    if (words[0] !== 'install') return;
    if (![3, 6, 9].includes(words.length) || words.slice(1, 6).some(word => !/^-?\d+$/.test(word))
      || words.slice(6).some(word => !Number.isFinite(Number(word))))
      throw new Error(`Invalid part install command: ${command}`);
    const child = this.gameTypes.getResource(receiver);
    const root = this.gameTypes.getById(Number(words[2]));
    let parent = Number(words[4] ?? 0) ? this.gameTypes.getById(Number(words[4])) : root;
    let requestedOwn = Number(words[3] ?? 0), requestedParent = Number(words[5] ?? 0);
    // Inventory uses the short form, or appends a drop position with zero mount
    // IDs. Resolve those through the same native query Java's installCheck used.
    if (child && root && !Number(words[4] ?? 0)) {
      const selectedParent = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
      const position = words.length === 9 ? jv('Vector3', { className: 'java.lang.Vector3',
        fields: new Map(['x', 'y', 'z'].map((axis, index) => [axis, jv('float', Number(words[6 + index]))])) }) : jv('Vector3', null);
      const selected = await this.jvm.natives.invokeAsync('java.game.parts.Part', 'install_OK', receiver,
        [jv('GameRef', this.gameTypes.reference(root).value), jv('int', requestedOwn), selectedParent, jv('int', requestedParent), position]);
      if (!selected?.value) return;
      [requestedOwn, requestedParent] = selected.value as number[];
      parent = this.gameTypes.getResource(selectedParent);
    }
    if (!child || !parent || !root || child === parent) return;
    if (parent !== root && !this.isDescendant(parent, root)) return;
    const childState = this.partSlots(this.gameTypes.reference(child));
    const candidates: ResourceObject[] = [];
    const seen = new Set<ResourceObject>();
    const visit = (node: ResourceObject): void => {
      if (seen.has(node) || node === child) return;
      seen.add(node);
      candidates.push(node);
      for (const descendant of node.children) visit(descendant);
    };
    visit(parent);
    visit(root);
    for (const candidate of candidates) {
      const parentState = this.partSlots(this.gameTypes.reference(candidate));
      for (const slot of parentState.slots) {
        if (requestedParent && slot.id !== requestedParent) continue;
        if (parentState.disabled.has(slot.id)) continue;
        if (parentState.installed.has(slot.id)) continue;
        for (const own of childState.slots) {
          if (requestedOwn && own.id !== requestedOwn) continue;
          const compatible = await this.matches(candidate, slot, child, own);
          if (!compatible) continue;
          child.setParent(candidate);
          parentState.installed.set(slot.id, { child, mate: own.id });
          childState.parentSlot = slot.id;
          childState.ownSlot = own.id;
          // The native car installer notifies its chassis through the original
          // Java callbacks. attachedParts is the car-wide script inventory,
          // including nested engine/running-gear parts, not just direct slots.
          const car = this.carNode(this.gameTypes.reference(child));
          if (car) {
            const carHandle = this.gameTypes.reference(car);
            if ((carHandle.value as JavaObject)?.fields.has('attachedParts')) {
              const notify = async (installed: ResourceObject): Promise<void> => {
                const handle = this.gameTypes.reference(installed);
                if ((handle.value as JavaObject)?.fields.has('attachedParts'))
                  await this.jvm.invokeAsync(carHandle, 'addpart', [handle]);
                // Part.load builds a loose engine's children before installing
                // the assembled engine onto the chassis.
                for (const nested of installed.children) await notify(nested);
              };
              await notify(child);
            }
          }
          const childHandle = this.gameTypes.reference(child);
          if ((childHandle.value as JavaObject)?.fields.has('attachedParts'))
            await this.jvm.invokeAsync(childHandle, 'install');
          return;
        }
      }
    }
  }

  private async matches(parent: ResourceObject, slot: CfgSlot, child: ResourceObject, own: CfgSlot): Promise<boolean> {
    if (this.compatibleSlots) return this.compatibleSlots(parent, slot, child, own);
    return [...slot.attach, ...slot.compatible].some(ref =>
      ref.slot === own.id && (ref.resource & 0xffff) === (child.typeId & 0xffff))
      || [...own.attach, ...own.compatible].some(ref =>
        ref.slot === slot.id && (ref.resource & 0xffff) === (parent.typeId & 0xffff));
  }

  private async compatibility(receiver: JavaValue, target: JavaValue, installable: boolean): Promise<number> {
    const [id, requestedSlot = 0] = String(target.value ?? '').trim().split(/\s+/).map(Number);
    const root = this.gameTypes.getById(id), child = this.gameTypes.getResource(receiver);
    if (!root || !child || root === child) return 0;
    const ownSlots = this.partSlots(this.gameTypes.reference(child)).slots;
    const visit = async (parent: ResourceObject): Promise<boolean> => {
      if (parent === child) return false;
      const state = this.partSlots(this.gameTypes.reference(parent));
      for (const slot of state.slots) {
        if (requestedSlot && slot.id !== requestedSlot) continue;
        // Compatibility includes occupied mounts; installability needs a free,
        // enabled mount. Neither query mutates the installed Java part tree.
        if (installable && (state.disabled.has(slot.id) || state.installed.has(slot.id))) continue;
        for (const own of ownSlots) if (await this.matches(parent, slot, child, own)) return true;
      }
      for (const nested of state.installed.values()) if (await visit(nested.child)) return true;
      return false;
    };
    return await visit(root) ? 1 : 0;
  }

  private isDescendant(node: ResourceObject, ancestor: ResourceObject): boolean {
    for (let current: ResourceObject | null = node.parent; current; current = current.parent)
      if (current === ancestor) return true;
    return false;
  }

  wearLimit(receiver: JavaValue): number | undefined {
    return this.maxWear.get(receiver.value as JavaObject);
  }
}

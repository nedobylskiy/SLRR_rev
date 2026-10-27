import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { ResourceObject } from './resource-object';
import type { PartConfig, CfgSlot } from '../formats/cfg';

interface InstalledSlot { child: ResourceObject; mate: number }
interface PartSlots {
  slots: CfgSlot[];
  installed: Map<number, InstalledSlot>;
  disabled: Set<number>;
  parentSlot: number;
  ownSlot: number;
}

/** Native condition values owned by each interpreted SLRR part. */
export class PartNative {
  private readonly maxWear = new WeakMap<JavaObject, number>();
  private readonly wear = new WeakMap<JavaObject, number>();
  private readonly texture = new WeakMap<JavaObject, number>();
  private readonly slots = new WeakMap<ResourceObject, PartSlots>();
  private readonly configs = new WeakMap<JavaObject, PartConfig | null>();

  constructor(private readonly jvm: SlrrJvm, private readonly gameTypes: GameTypeNative) {
    const owner = 'java.game.parts.Part';
    gameTypes.setCommandHandler((receiver, command) => this.command(receiver, command));
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
    jvm.natives.register(owner, 'getWear', [], ({ receiver }) =>
      jv('float', this.wear.get(receiver.value as JavaObject) ?? 1));
    jvm.natives.register(owner, 'setWear', ['float'], ({ receiver, args }) => {
      const value = Math.fround(Number(args[0].value));
      if (!Number.isFinite(value)) throw new Error('Invalid part wear');
      this.wear.set(receiver.value as JavaObject, value);
      return jv('float', value);
    });
    // Deformation is held at pristine condition until Java parts are linked to the physics bodies.
    jvm.natives.register(owner, 'getTear', [], () => jv('float', 1));
    jvm.natives.register(owner, 'setTear', ['float'], ({ args }) => jv('float', Math.fround(Number(args[0].value))));
    jvm.natives.register(owner, 'setMaxWear', ['float'], ({ receiver, args }) => {
      const limit = Number(args[0].value);
      if (!Number.isFinite(limit) || limit < 0) throw new Error('Invalid part maximum wear');
      this.maxWear.set(receiver.value as JavaObject, limit);
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'getTexture', [], ({ receiver }) =>
      jv('int', this.texture.get(receiver.value as JavaObject) ?? 0));
    jvm.natives.register(owner, 'setTexture', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value);
      if (!Number.isInteger(id)) throw new Error('Invalid part texture resource ID');
      this.texture.set(receiver.value as JavaObject, id | 0);
      // The original native reports success even when no render object is bound yet.
      return jv('int', 1);
    });
    jvm.natives.register(owner, 'getCar', [], ({ receiver }) => {
      return jv('int', this.carNode(receiver)?.resourceId ?? 0);
    });
  }

  configure(receiver: JavaValue, cfg: PartConfig | null): void {
    this.configs.set(receiver.value as JavaObject, cfg);
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

  private partSlots(receiver: JavaValue): PartSlots {
    const node = this.gameTypes.getResource(receiver);
    if (!node) throw new Error('Part has no native game object');
    let state = this.slots.get(node);
    if (!state) {
      state = { slots: this.configs.get(receiver.value as JavaObject)?.slots ?? [],
        installed: new Map(), disabled: new Set(), parentSlot: 0, ownSlot: 0 };
      this.slots.set(node, state);
    }
    return state;
  }

  private carNode(receiver: JavaValue): ResourceObject | null {
    for (let node: ResourceObject | null | undefined = this.gameTypes.get(receiver); node; node = node.parent) {
      for (let className: string | null = node.className; className; className = this.jvm.parent(className))
        if (className === 'java.game.parts.bodypart.Chassis') return node;
    }
    return null;
  }

  private command(receiver: JavaValue, command: string): void {
    const words = command.trim().split(/\s+/);
    if (words[0] !== 'install') return;
    if (words.length !== 6 || words.slice(1).some(word => !/^\d+$/.test(word)))
      throw new Error(`Invalid part install command: ${command}`);
    const child = this.gameTypes.getResource(receiver);
    const parent = this.gameTypes.getById(Number(words[4]));
    const root = this.gameTypes.getById(Number(words[2]));
    if (!child || !parent || !root || child === parent) return;
    if (parent !== root && !this.isDescendant(parent, root)) return;
    const childState = this.partSlots(this.gameTypes.reference(child));
    const requestedOwn = Number(words[3]), requestedParent = Number(words[5]);
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
          const parentAccepts = [...slot.attach, ...slot.compatible].some(ref =>
            ref.slot === own.id && (ref.resource & 0xffff) === (child.typeId & 0xffff));
          const childAccepts = [...own.attach, ...own.compatible].some(ref =>
            ref.slot === slot.id && (ref.resource & 0xffff) === (candidate.typeId & 0xffff));
          if (!parentAccepts && !childAccepts) continue;
          child.setParent(candidate);
          parentState.installed.set(slot.id, { child, mate: own.id });
          childState.parentSlot = slot.id;
          childState.ownSlot = own.id;
          return;
        }
      }
    }
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

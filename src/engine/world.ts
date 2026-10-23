import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { Assets, normalizePath } from '../assets';
import { entryProperties } from '../formats/rpk';
import { parsePartConfig, type CfgPose, type CfgSlot, type PartConfig } from '../formats/cfg';
import { FixedClock } from '../runtime/fixed-clock';

export interface ResourceKey { pack: string; id: number }
export interface PartDefinition {
  key: ResourceKey; alias: string; script?: string; cfgPath: string; config: PartConfig;
  model?: { path: string; textures: string[] };
}
export const resourceKey = (key: ResourceKey) => `${normalizePath(key.pack)}:${key.id}`;
export function poseMatrix(pose: CfgPose) {
  const [yaw, pitch, roll] = pose.rotation;
  return new Matrix4().compose(new Vector3(...pose.position), new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ')), new Vector3(1, 1, 1));
}

/** Assets are shared; instances and slot occupancy belong exclusively to a world. */
export class EnginePart {
  readonly children = new Map<number, EnginePart>();
  readonly local = new Matrix4();
  parent?: EnginePart;
  parentSlot?: number;
  ownSlot?: number;
  constructor(readonly world: EngineWorld, readonly id: number, readonly definition: PartDefinition) {}
  matrix(): Matrix4 { return this.parent ? this.parent.matrix().multiply(this.local) : this.local.clone(); }
}

export class EngineWorld {
  readonly parts = new Map<number, EnginePart>();
  readonly clock = new FixedClock();
  private nextId = 1;
  disposed = false;
  create(definition: PartDefinition) {
    if (this.disposed) throw new Error('World disposed');
    if (this.parts.size >= 10000) throw new Error('World part limit');
    const part = new EnginePart(this, this.nextId++, definition); this.parts.set(part.id, part); return part;
  }
  install(parent: EnginePart, parentSlot: number, child: EnginePart, ownSlot: number) {
    for (const part of [parent, child]) if (part.world !== this || this.parts.get(part.id) !== part || this.disposed) throw new Error('Part outside live world');
    for (let p: EnginePart | undefined = parent; p; p = p.parent) if (p === child) throw new Error('Attachment cycle');
    if (child.parent || parent.children.has(parentSlot) || parent.ownSlot === parentSlot || child.children.has(ownSlot)) throw new Error('Occupied attachment');
    const a = parent.definition.config.slots.find(s => s.id === parentSlot), b = child.definition.config.slots.find(s => s.id === ownSlot);
    if (!a || !b) throw new Error('Missing attachment slot');
    child.local.copy(poseMatrix(a)).multiply(poseMatrix(b).invert());
    child.parent = parent; child.parentSlot = parentSlot; child.ownSlot = ownSlot; parent.children.set(parentSlot, child);
  }
  detach(child: EnginePart) {
    if (this.parts.get(child.id) !== child || this.disposed) throw new Error('Part outside live world');
    const matrix = child.matrix();
    if (child.parent) child.parent.children.delete(child.parentSlot!);
    child.parent = undefined; child.parentSlot = child.ownSlot = undefined; child.local.copy(matrix);
  }
  advance(seconds: number) { if (this.disposed) throw new Error('World disposed'); return this.clock.advance(seconds, () => { /* Native simulation systems will run here. */ }); }
  dispose() { for (const part of this.parts.values()) { part.children.clear(); part.parent = undefined; } this.parts.clear(); this.disposed = true; }
}

/** No Java constructor or implicit native behavior is substituted by this factory. */
export class PartFactory {
  private definitions = new Map<string, Promise<PartDefinition>>();
  constructor(readonly assets: Assets) {}
  async definition(key: ResourceKey): Promise<PartDefinition> {
    const resolved = await this.assets.resource(key.pack, key.id);
    const canonical = { pack: normalizePath(resolved.packPath), id: resolved.entry.typeId }, cacheKey = resourceKey(canonical);
    let pending = this.definitions.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const props = entryProperties(resolved.entry), native = props.find(p => p.key === 'native')?.value;
        const match = /^(?:car|part)\s+(.+\.cfg)$/i.exec(native ?? '');
        if (!match) throw new Error(`No native car/part CFG: ${cacheKey}`);
        const cfgPath = normalizePath(match[1]);
        const config = parsePartConfig(new TextDecoder('windows-1252').decode(await this.assets.read(cfgPath)));
        const renderId = config.render ?? config.mesh;
        const model = renderId === undefined ? undefined : await this.assets.modelForResource(canonical.pack, renderId);
        return { key: canonical, alias: resolved.entry.alias, script: props.find(p => p.key === 'script')?.value, cfgPath, config, model };
      })();
      this.definitions.set(cacheKey, pending);
      pending.catch(() => { if (this.definitions.get(cacheKey) === pending) this.definitions.delete(cacheKey); });
    }
    return pending;
  }
  private async pointsTo(from: PartDefinition, slot: CfgSlot, target: PartDefinition, targetSlot: number) {
    for (const attachment of slot.attach) {
      if (attachment.slot !== targetSlot) continue;
      const resolved = await this.assets.resourceLocation(from.key.pack, attachment.resource);
      if (resourceKey({ pack: resolved.packPath, id: resolved.id }) === resourceKey(target.key)) return true;
    }
    return false;
  }
  private async attachment(world: EngineWorld, child: PartDefinition) {
    for (const parent of world.parts.values()) for (const a of parent.definition.config.slots) {
      if (parent.children.has(a.id) || parent.ownSlot === a.id) continue;
      for (const b of child.config.slots) {
        if (await this.pointsTo(child, b, parent.definition, a.id) || await this.pointsTo(parent.definition, a, child, b.id)) return { parent, parentSlot: a.id, ownSlot: b.id };
      }
    }
  }
  /** Read ordered stockpart declarations; unresolved compatibility is reported, never guessed. */
  async stock(key: ResourceKey) {
    const world = new EngineWorld(), warnings: string[] = [];
    try {
      const root = world.create(await this.definition(key));
      const pending: PartDefinition[] = [];
      const enqueue = async (parent: PartDefinition) => {
        for (const id of parent.config.stock) {
          if (pending.length + world.parts.size >= 1000) throw new Error('Stock expansion limit');
          pending.push(await this.definition({ pack: parent.key.pack, id }));
        }
      };
      await enqueue(root.definition);
      while (pending.length) {
        let progress = false;
        for (let i = 0; i < pending.length;) {
          const definition = pending[i], mount = await this.attachment(world, definition);
          if (!mount) { i++; continue; }
          const child = world.create(definition); world.install(mount.parent, mount.parentSlot, child, mount.ownSlot);
          pending.splice(i, 1); await enqueue(definition); progress = true;
        }
        if (!progress) break;
      }
      for (const part of pending) warnings.push(`Uninstalled stockpart ${resourceKey(part.key)} (${part.alias}): compatible slot not resolved`);
      return { world, root, warnings };
    } catch (error) { world.dispose(); throw error; }
  }
}

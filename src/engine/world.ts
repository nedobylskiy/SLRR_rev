import { Matrix4 } from 'three';
import { Assets, normalizePath } from '../assets';
import { entryProperties } from '../formats/rpk';
import { parsePartConfig, type CfgSlot, type PartConfig } from '../formats/cfg';
import { FixedClock } from '../runtime/fixed-clock';
import { slotMatrix } from './slot-frames';
import { OriginalStock, type MechanicalProfile, type WheelCorner } from './original-stock';
export { poseMatrix } from './transforms';

export interface ResourceKey { pack: string; id: number }
export interface PartDefinition {
  key: ResourceKey; alias: string; script?: string; cfgPath: string; config: PartConfig;
  model?: { path: string; textures: string[] };
  mechanics?: MechanicalProfile;
}
export const resourceKey = (key: ResourceKey) => `${normalizePath(key.pack)}:${key.id}`;

/** Assets are shared; instances and slot occupancy belong exclusively to a world. */
export class EnginePart {
  readonly children = new Map<number, EnginePart>();
  readonly local = new Matrix4();
  slotFrame(slot: CfgSlot) { return slotMatrix(this.definition.config, slot); }
  parent?: EnginePart;
  parentSlot?: number;
  ownSlot?: number;
  private health = 1;
  get condition() { return this.health; }
  set condition(value: number) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid part condition'); this.health = value; }
  constructor(readonly world: EngineWorld, readonly id: number, readonly definition: PartDefinition) {}
  matrix(): Matrix4 { return this.parent ? this.parent.matrix().multiply(this.local) : this.local.clone(); }
}

export class EngineWorld {
  readonly parts = new Map<number, EnginePart>();
  readonly clock = new FixedClock();
  private nextId = 1;
  disposed = false;
  mechanical = false;
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
    child.local.copy(parent.slotFrame(a)).multiply(child.slotFrame(b).invert());
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
  private aliases = new Map<string, Promise<Set<string>>>();
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
        let config: PartConfig;
        try { config = parsePartConfig(new TextDecoder('windows-1252').decode(await this.assets.read(cfgPath))); }
        catch (error) { throw new Error(`${cfgPath}: ${String(error)}`); }
        const renderId = config.render ?? config.mesh;
        const model = renderId === undefined ? undefined : await this.assets.modelForResource(canonical.pack, renderId);
        return { key: canonical, alias: resolved.entry.alias, script: props.find(p => p.key === 'script')?.value, cfgPath, config, model };
      })();
      this.definitions.set(cacheKey, pending);
      pending.catch(() => { if (this.definitions.get(cacheKey) === pending) this.definitions.delete(cacheKey); });
    }
    return pending;
  }
  private async slotAliases(definition: PartDefinition, slot: CfgSlot) {
    const start = `${resourceKey(definition.key)}:${slot.id}`;
    let pending = this.aliases.get(start);
    if (!pending) {
      pending = (async () => {
        const found = new Set<string>(), queue = [{ definition, slot }];
        while (queue.length) {
          const current = queue.shift()!, identity = `${resourceKey(current.definition.key)}:${current.slot.id}`;
          if (found.has(identity)) continue;
          found.add(identity);
          if (found.size > 256) throw new Error('Slot compatibility expansion limit');
          for (const ref of current.slot.compatible) {
            const location = await this.assets.resourceLocation(current.definition.key.pack, ref.resource);
            const key = { pack: location.packPath, id: location.id }, alias = `${resourceKey(key)}:${ref.slot}`;
            if (found.has(alias)) continue;
            // An abstract compatibility identity may have no concrete native CFG.
            const entry = (await this.assets.pack(key.pack)).entries.find(e => e.typeId === key.id);
            if (!entry || !entryProperties(entry).some(p => p.key === 'native' && /^(car|part)\s+.+\.cfg$/i.test(p.value))) { found.add(alias); continue; }
            const other = await this.definition(key), otherSlot = other.config.slots.find(s => s.id === ref.slot);
            if (otherSlot) queue.push({ definition: other, slot: otherSlot });
            else found.add(alias);
          }
        }
        if (found.size > 256) throw new Error('Slot compatibility expansion limit');
        return found;
      })();
      this.aliases.set(start, pending); pending.catch(() => this.aliases.delete(start));
    }
    return pending;
  }
  private async pointsTo(from: PartDefinition, slot: CfgSlot, target: PartDefinition, targetSlot: CfgSlot) {
    if (!slot.attach.length) return false;
    const aliases = await this.slotAliases(target, targetSlot);
    for (const attachment of slot.attach) {
      const resolved = await this.assets.resourceLocation(from.key.pack, attachment.resource);
      if (aliases.has(`${resourceKey({ pack: resolved.packPath, id: resolved.id })}:${attachment.slot}`)) return true;
    }
    return false;
  }
  private async attachment(world: EngineWorld, child: PartDefinition) {
    for (const parent of world.parts.values()) for (const a of parent.definition.config.slots) {
      if (parent.children.has(a.id) || parent.ownSlot === a.id) continue;
      for (const b of child.config.slots) {
        if (await this.pointsTo(child, b, parent.definition, a) || await this.pointsTo(parent.definition, a, child, b)) return { parent, parentSlot: a.id, ownSlot: b.id };
      }
    }
  }
  /** Read ordered stockpart declarations; unresolved compatibility is reported, never guessed. */
  async stock(key: ResourceKey, options: { mechanical?: boolean } = {}) {
    const world = new EngineWorld(), warnings: string[] = [];
    try {
      const root = world.create(await this.definition(key));
      const source = new OriginalStock(this.assets), env = options.mechanical ? await source.environment(root.definition) : {};
      world.mechanical = !!options.mechanical;
      const pending: PartDefinition[] = [];
      const enqueue = async (parent: PartDefinition) => {
        for (const id of parent.config.stock) {
          if (pending.length + world.parts.size >= 1000) throw new Error('Stock expansion limit');
          pending.push(await this.definition({ pack: parent.key.pack, id }));
        }
      };
      await enqueue(root.definition);
      if (options.mechanical) {
        for (const ref of await source.entries(root.definition, env, true)) {
          const definition = await this.definition(ref), mechanics = await source.profile(definition); pending.push({ ...definition, mechanics });
        }
        if (pending.filter(d => d.mechanics?.kind === 'suspension').length > root.definition.config.wheels.length) throw new Error('Source stock suspension count exceeds CFG wheels');
      }
      while (pending.length) {
        let progress = false;
        for (let i = 0; i < pending.length;) {
          const definition = pending[i], mount = await this.attachment(world, definition);
          if (!mount) { i++; continue; }
          let installed = definition;
          if (definition.mechanics?.kind === 'brake' && definition.mechanics.renderVariants) {
            const type = mount.parent.definition.config.slots.find(s => s.id === mount.parentSlot)?.type;
            const corner = type !== undefined && type >= 201 && type <= 204 ? (['FL', 'FR', 'RL', 'RR'] as WheelCorner[])[type - 201] : undefined;
            const variant = corner && definition.mechanics.renderVariants[corner];
            if (variant) installed = { ...definition, model: await this.assets.modelForResource(variant.pack, variant.id) };
          }
          const child = world.create(installed); world.install(mount.parent, mount.parentSlot, child, mount.ownSlot);
          pending.splice(i, 1); await enqueue(definition); progress = true;
          if (options.mechanical && definition.mechanics) for (const ref of await source.entries(definition, env)) {
            if (pending.length + world.parts.size >= 1000) throw new Error('Original stock expansion limit');
            const d = await this.definition(ref); pending.push({ ...d, mechanics: await source.profile(d) });
          }
        }
        if (!progress) break;
      }
      for (const part of pending) warnings.push(`Uninstalled stockpart ${resourceKey(part.key)} (${part.alias}): compatible slot not resolved`);
      return { world, root, warnings };
    } catch (error) { world.dispose(); throw error; }
  }
}

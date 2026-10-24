import { Matrix4, Quaternion, Vector3 } from 'three';
import { Assets, normalizePath } from '../assets';
import { entryProperties } from '../formats/rpk';
import { parsePartConfig, type CfgPose, type CfgSlot, type PartConfig, type Triple } from '../formats/cfg';
import { FixedClock } from '../runtime/fixed-clock';
import { parseScx } from '../formats/scx';
import { slotMatrix } from './slot-frames';
import { SCX_TO_WORLD } from './model-transform';
import { poseMatrix } from './transforms';
import { OriginalStock, type MechanicalProfile, type WheelCorner } from './original-stock';
export { poseMatrix } from './transforms';

export interface ResourceKey { pack: string; id: number }
export interface PartDefinition {
  key: ResourceKey; alias: string; script?: string; cfgPath: string; config: PartConfig;
  model?: { path: string; textures: string[] };
  additionalModels?: { model: { path: string; textures: string[] }; pose?: CfgPose }[];
  mechanics?: MechanicalProfile;
}
export const resourceKey = (key: ResourceKey) => `${normalizePath(key.pack)}:${key.id}`;

/** Assets are shared; instances and slot occupancy belong exclusively to a world. */
export class EnginePart {
  readonly children = new Map<number, EnginePart>();
  readonly local = new Matrix4();
  readonly renderAdjustment = new Matrix4();
  readonly slotPositions = new Map<number, Triple>();
  slotFrame(slot: CfgSlot) { const position = this.slotPositions.get(slot.id); return slotMatrix(this.definition.config, position ? { ...slot, position } : slot); }
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
        const extraRenders = config.render === config.renders[0]?.resource ? config.renders.slice(1) : [];
        const additionalModels = (await Promise.all(extraRenders.map(async render => {
          try { return { model: await this.assets.modelForResource(canonical.pack, render.resource), pose: render.pose }; }
          catch (error) {
            if (/has no external SCX\/render\/mesh/.test(String(error))) return undefined;
            throw error;
          }
        }))).filter(model => model !== undefined);
        return { key: canonical, alias: resolved.entry.alias, script: props.find(p => p.key === 'script')?.value, cfgPath, config, model, additionalModels };
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
      if (options.mechanical) for (const part of world.parts.values()) {
        if (part.definition.mechanics?.kind !== 'suspension' || part.parent !== root) continue;
        const mount = root.definition.config.slots.find(s => s.id === part.parentSlot), type = mount?.type;
        if (type === undefined || type < 201 || type > 204) continue;
        for (const command of part.definition.mechanics.slotPositions ?? []) {
          const id = command.base + type - 201, slot = root.definition.config.slots.find(s => s.id === id);
          if (!slot) continue;
          root.slotPositions.set(id, command.position);
          const child = root.children.get(id), own = child?.definition.config.slots.find(s => s.id === child.ownSlot);
          if (child && own) child.local.copy(root.slotFrame(slot)).multiply(child.slotFrame(own).invert());
        }
      }
      if (options.mechanical) for (const part of world.parts.values()) {
        const kind = part.definition.mechanics?.kind;
        if (kind !== 'shock' && kind !== 'spring' || part.parent !== root) continue;
        const slot = root.definition.config.slots.find(s => s.id === part.parentSlot);
        const type = slot?.type, model = part.definition.model;
        if (!slot || type === undefined || !(type >= 201 && type <= 204 || type >= 301 && type <= 304) || !model) continue;
        const corner = type % 100 - 1;
        const linked = part.definition.config.links.find(link => link.length >= 2 &&
          root.definition.config.slots.some(s => s.id === link[0] + corner && s.bonePosition) &&
          root.definition.config.slots.some(s => s.id === link[1] + corner));
        if (!linked) continue;
        const lowerSlot = root.definition.config.slots.find(s => s.id === linked[0] + corner)!;
        const wheel = root.definition.config.wheels[type % 100 - 1];
        if (!wheel) continue;
        // linked identifies the two chassis anchors. A spring can mount at a separate
        // CFG slot while its mesh follows the damper's lower anchor.
        const inverse = part.local.clone().invert();
        const lower = new Vector3().setFromMatrixPosition(root.slotFrame(lowerSlot)).applyMatrix4(inverse);
        const upper = new Vector3(...lowerSlot.bonePosition!).applyMatrix4(poseMatrix(wheel)).applyMatrix4(inverse);
        const axis = upper.sub(lower), length = axis.length();
        if (length < 0.01) continue;
        const geometry = parseScx(await this.assets.read(model.path)), renderPose = part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const mesh of geometry.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
          const point = new Vector3().fromArray(mesh.positions, i).multiplyScalar(SCX_TO_WORLD);
          if (renderPose) point.applyMatrix4(renderPose);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
          minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
        }
        if (maxY - minY < 0.01) continue;
        part.renderAdjustment.makeTranslation(lower.x, lower.y, lower.z)
          .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize())))
          .multiply(new Matrix4().makeScale(1, length / (maxY - minY), 1))
          .multiply(new Matrix4().makeTranslation(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2));
      }
      return { world, root, warnings };
    } catch (error) { world.dispose(); throw error; }
  }
}

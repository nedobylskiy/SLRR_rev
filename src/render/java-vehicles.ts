import { jv, type JavaObject, type JavaValue } from 'slrr-jvm';
import type { Assets } from '../assets';
import { normalizeResourcePackPath } from '../assets';
import { PartFactory } from '../engine/world';
import { poseMatrix } from '../engine/transforms';
import { Vector3 } from 'three';
import type { MapTerrain } from '../engine/map-terrain';
import type { BootResult } from '../runtime/game-boot';
import { GameObject } from '../runtime/game-object';
import { javaStockSelection } from '../runtime/java-scene';
import type { Viewer } from './viewer';

type BuiltVehicle = Awaited<ReturnType<PartFactory['stock']>>;

/** Projects vehicles owned by the current Java map, including dealer stock, without driving them. */
export class JavaSceneVehicles {
  private readonly models = new Map<GameObject, BuiltVehicle>();
  private readonly assemblies = new WeakMap<BuiltVehicle, string>();
  private readonly failed = new WeakSet<GameObject>();
  private wanted = new Set<GameObject>();
  private loading = false;
  private disposed = false;
  private terrain?: Pick<MapTerrain, 'height'>;
  private readonly settled = new WeakMap<BuiltVehicle, { pose: GameObject; revision: number }>();
  constructor(private readonly result: BootResult, private readonly assets: Assets,
    private readonly viewer: Pick<Viewer, 'showWorld' | 'removeWorld' | 'syncWorldVisuals'>,
    private readonly report: (message: string) => void,
    private readonly factory: Pick<PartFactory, 'stock'> = new PartFactory(assets)) {}

  update(map: JavaValue | null, terrain?: Pick<MapTerrain, 'height'>): void {
    if (this.disposed) return;
    this.terrain = terrain;
    const { gameTypes, jvm } = this.result;
    const root = map && gameTypes.getResource(map);
    const vehicles = new Map<GameObject, JavaValue>();
    let priority: number | undefined;
    const consider = (ref: JavaValue): void => {
      if (!ref?.value || typeof ref.value !== 'object' || !('fields' in ref.value)) return;
      const node = gameTypes.get(ref);
      if (!root || !node || node.parent !== root) return;
      try { if (jvm.get(ref, 'chassis').value != null) vehicles.set(node, ref); } catch { /* Non-vehicle reference. */ }
    };
    for (const child of root?.children ?? []) consider(gameTypes.reference(child));
    // Vehicle and its scripted chassis share a native handle. The native tree's
    // canonical reference can therefore be the Chassis, not the Vehicle wrapper.
    try {
      const state = jvm.get(jv('class', 'java.game.GameLogic'), 'actualState').value as JavaObject | null;
      for (const value of state?.fields.values() ?? []) {
        if (Array.isArray(value.value)) for (const item of value.value) {
          if (item && typeof item === 'object' && 'value' in item) consider(item as JavaValue);
          else if (item && typeof item === 'object' && 'className' in item)
            consider(jv((item as JavaObject).className, item));
        }
        else consider(value);
      }
      for (const name of ['cam', 'camera']) {
        const camera = state?.fields.get(name);
        const move = camera && gameTypes.lastCommand(camera, 'move');
        if (move) priority = Number(move.trim().split(/\s+/)[1]);
      }
      const player = jvm.get(jv('class', 'java.game.GameLogic'), 'player');
      if (player.value != null) consider(jvm.get(player, 'car'));
    } catch { /* No active Java section/player yet. */ }
    this.wanted = new Set(vehicles.keys());
    for (const [node, built] of this.models) {
      if (!this.wanted.has(node)) { this.release(built); this.models.delete(node); }
      else if (this.assemblies.get(built) !== this.signature(vehicles.get(node)!)) {
        this.release(built); this.models.delete(node);
      } else this.sync(node, built, vehicles.get(node)!);
    }
    if (this.loading) return;
    const pending = [...vehicles].filter(([node]) => !this.models.has(node) && !this.failed.has(node));
    const next = pending.find(([node]) => node.resourceId === priority) ?? pending[0];
    if (!next) return;
    this.loading = true;
    void this.load(...next).finally(() => { this.loading = false; });
  }

  private sync(node: GameObject, built: BuiltVehicle, ref: JavaValue): void {
    const chassis = this.result.gameTypes.get(this.result.jvm.get(ref, 'chassis'));
    // Chassis.setState is used for the dealer's rotating display stand.
    const pose = chassis && chassis.poseRevision > node.poseRevision ? chassis : node;
    built.root.local.copy(poseMatrix({ position: [pose.position.x, pose.position.y, pose.position.z],
      rotation: [pose.orientation.y, pose.orientation.p, pose.orientation.r] }));
    // Native physics normally resolves a freshly placed car out of the floor.
    // Static displays have no driving solver, so resolve wheel penetration here.
    let lift = 0;
    const settled = this.settled.get(built);
    const needsContact = this.terrain && (settled?.pose !== pose || settled.revision !== pose.poseRevision);
    if (needsContact) for (const slot of built.root.definition.config.slots) {
      if (slot.type === undefined || slot.type < 101 || slot.type > 199 || !built.root.children.has(slot.id)) continue;
      const wheel = built.root.definition.config.wheels[slot.type - 101];
      if (!wheel?.radius) continue;
      const center = new Vector3().setFromMatrixPosition(built.root.slotFrame(slot)).applyMatrix4(built.root.local);
      const radius = wheel.radius * (built.world.wheelRefs[slot.type - 101]?.radius ?? 0.32865) / 0.32865;
      // Search the placement's floor, not furniture/ceilings above its origin.
      const ground = this.terrain!.height(center.x, center.z, pose.position.y);
      if (Number.isFinite(ground) && ground > -999) lift = Math.max(lift, ground - (center.y - radius));
    }
    if (lift > 0.001) {
      pose.setMatrix({ ...pose.position, y: pose.position.y + lift }, pose.orientation);
      built.root.local.elements[13] += lift;
    }
    if (needsContact) this.settled.set(built, { pose, revision: pose.poseRevision });
    this.viewer.syncWorldVisuals(built.world);
  }

  private async load(node: GameObject, ref: JavaValue): Promise<void> {
    let built: BuiltVehicle | undefined;
    try {
      const chassis = this.result.jvm.get(ref, 'chassis');
      const native = this.result.gameTypes.getResource(chassis);
      if (!native) throw new Error('Java vehicle has no native chassis');
      const identity = this.result.resolveResourceIdentity(native.typeId);
      const pack = normalizeResourcePackPath(identity?.pack ?? native.resourcePack ?? '');
      if (!pack) throw new Error('Java chassis has no resource pack');
      const key = { pack, id: identity?.id ?? native.typeId };
      const selection = await javaStockSelection(this.result, this.assets, pack, ref);
      const signature = this.signature(ref);
      built = await this.factory.stock(key, { mechanical: true, javaSelection: selection });
      this.assemblies.set(built, signature);
      if (this.disposed || !this.wanted.has(node)) { built.world.dispose(); return; }
      this.sync(node, built, ref);
      await this.viewer.showWorld(built.world, this.assets, true, true);
      if (this.disposed || !this.wanted.has(node)) { this.release(built); return; }
      this.models.set(node, built);
    } catch (error) {
      if (built) this.release(built);
      if (!this.disposed && this.wanted.has(node)) {
        this.failed.add(node);
        this.report(`Java vehicle ${node.alias}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private signature(ref: JavaValue): string {
    const visit = (nodes: ReturnType<BootResult['parts']['installedTree']>): string => nodes.map(part =>
      `${part.node.resourceId}:${part.parentSlot}:${part.ownSlot}[${visit(part.children)}]`).join(',');
    return visit(this.result.parts.installedTree(this.result.jvm.get(ref, 'chassis')));
  }

  private release(built: BuiltVehicle): void { this.viewer.removeWorld(built.world); built.world.dispose(); }
  dispose(): void {
    this.disposed = true; this.wanted.clear();
    for (const built of this.models.values()) this.release(built);
    this.models.clear();
  }
}

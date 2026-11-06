import { jv, type JavaObject, type JavaValue } from 'slrr-jvm';
import type { Assets } from '../assets';
import { normalizeResourcePackPath } from '../assets';
import { PartFactory } from '../engine/world';
import { poseMatrix } from '../engine/transforms';
import { applyDisplaySteering } from '../engine/display-steering';
import { resetParkedRunningGear, settleParkedSuspension } from '../engine/parked-suspension';
import { Euler, Quaternion, Vector3 } from 'three';
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
  private readonly settled = new WeakMap<BuiltVehicle, { pose: GameObject; revision: number; contacts:string }>();
  private readonly synced = new WeakMap<BuiltVehicle, {
    geometry: string; steering: number | undefined; pose: GameObject; revision: number; filters: string; terrain: boolean;
  }>();
  constructor(private readonly result: BootResult, private readonly assets: Assets,
    private readonly viewer: Pick<Viewer, 'showWorld' | 'removeWorld' | 'syncWorldVisuals' | 'calibrationSteering'>&Partial<Pick<Viewer,'profiler'>>,
    private readonly report: (message: string) => void,
    private readonly factory: Pick<PartFactory, 'stock' | 'syncJavaAssembly'> = new PartFactory(assets)) {}

  update(map: JavaValue | null, terrain?: Pick<MapTerrain, 'height'>): void {
    if(this.viewer.profiler)this.viewer.profiler.measure('Parked vehicles update CPU',()=>this.updateCore(map,terrain));
    else this.updateCore(map,terrain);
  }
  private updateCore(map:JavaValue|null,terrain?:Pick<MapTerrain,'height'>):void {
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
    const changed: [GameObject, JavaValue][] = [];
    for (const [node, built] of this.models) {
      if (!this.wanted.has(node)) { this.release(built); this.models.delete(node); }
      else {
        const ref = vehicles.get(node)!;
        if (this.assemblies.get(built) !== this.signature(ref)) changed.push([node, ref]);
        this.sync(node, built, ref);
      }
    }
    if (this.loading) return;
    const edit = changed.find(([node]) => node.resourceId === priority) ?? changed[0];
    if (edit) {
      this.loading = true;
      void this.refresh(edit[0], edit[1], this.models.get(edit[0])!).finally(() => { this.loading = false; });
      return;
    }
    const pending = [...vehicles].filter(([node]) => !this.models.has(node) && !this.failed.has(node));
    const next = pending.find(([node]) => node.resourceId === priority) ?? pending[0];
    if (!next) return;
    this.loading = true;
    void this.load(...next).finally(() => { this.loading = false; });
  }

  private async refresh(node: GameObject, ref: JavaValue, built: BuiltVehicle): Promise<void> {
    try {
      const signature = this.signature(ref);
      const selection = await javaStockSelection(this.result, this.assets, built.root.definition.key.pack, ref);
      if (this.disposed || !this.wanted.has(node) || built.world.disposed) return;
      await this.factory.syncJavaAssembly(built.root, selection);
      if (this.disposed || !this.wanted.has(node) || built.world.disposed) return;
      this.settled.delete(built);
      this.synced.delete(built);
      this.sync(node, built, ref);
      // showWorld skips existing GPU proxies and publishes only new part meshes.
      await this.viewer.showWorld(built.world, this.assets, true, true);
      if (built.world.disposed) this.viewer.removeWorld(built.world);
      else this.assemblies.set(built, signature);
    } catch (error) {
      if (!this.disposed && this.wanted.has(node)) {
        this.assemblies.set(built, this.signature(ref));
        this.report(`Java vehicle update ${node.alias}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private sync(node: GameObject, built: BuiltVehicle, ref: JavaValue): void {
    const chassisRef=this.result.jvm.get(ref,'chassis');
    const chassis = this.result.gameTypes.get(chassisRef);
    // WheelRef instances can appear/rebind after the assembly was first shown.
    built.world.wheelRefs=built.root.definition.config.wheels.map((_,index)=>this.result.chassis.wheelState(chassisRef,index));
    // Chassis.setState is used for the dealer's rotating display stand.
    const pose = chassis && chassis.poseRevision > node.poseRevision ? chassis : node;
    const steering = this.viewer.calibrationSteering ?? node.steeringInput ?? chassis?.steeringInput;
    const geometry = this.geometrySignature(built);
    const filters = JSON.stringify([[...node.renderFilters], [...chassis?.renderFilters ?? []]]);
    const previous = this.synced.get(built);
    const runningGearChanged = !previous || previous.geometry !== geometry || previous.steering !== steering;
    if (!runningGearChanged && previous.pose === pose && previous.revision === pose.poseRevision
      && previous.filters === filters && previous.terrain === !!this.terrain) return;
    built.root.local.copy(poseMatrix({ position: [pose.position.x, pose.position.y, pose.position.z],
      rotation: [pose.orientation.y, pose.orientation.p, pose.orientation.r] }));
    // Moving the chassis does not change the loaded spring pose or assembly mass.
    if (runningGearChanged) {
      resetParkedRunningGear(built.root);
      if (steering !== undefined) applyDisplaySteering(built.root, steering);
      settleParkedSuspension(built.root, steering);
    }
    const suspended = built.root.definition.config.wheels.length === 4
      && built.world.wheelRefs.some(wheel => wheel && wheel.force > 0 && wheel.restLength > 0);
    // Native physics normally resolves a freshly placed car out of the floor.
    // Static displays have no driving solver, so resolve wheel penetration here.
    let lift = suspended ? -Infinity : 0;
    const settled = this.settled.get(built);
    const contacts:{center:Vector3;radius:number}[]=[];
    const contactKey:number[]=[];
    for (const slot of built.root.definition.config.slots) {
      if (slot.type === undefined || slot.type < 101 || slot.type > 199 || !built.root.children.has(slot.id)) continue;
      const wheel = built.root.definition.config.wheels[slot.type - 101];
      if (!wheel?.radius) continue;
      const part = built.root.children.get(slot.id)!;
      const own = part.definition.config.slots.find(own => own.id === part.ownSlot);
      const frame = own ? part.local.clone().multiply(part.slotFrame(own)) : built.root.slotFrame(slot);
      const center = new Vector3().setFromMatrixPosition(frame);
      const radius = wheel.radius * (built.world.wheelRefs[slot.type - 101]?.radius ?? 0.32865) / 0.32865;
      contactKey.push(center.x,center.y,center.z,radius);
      contacts.push({center:center.applyMatrix4(built.root.local),radius});
    }
    const contactSignature=contactKey.join(',');
    const needsContact=this.terrain&&(settled?.pose!==pose||settled.revision!==pose.poseRevision||settled.contacts!==contactSignature);
    if(needsContact)for(const {center,radius} of contacts){
      // Search the placement's floor, not furniture/ceilings above its origin.
      const ground = this.terrain!.height(center.x, center.z, pose.position.y);
      if (Number.isFinite(ground) && ground > -999) lift = Math.max(lift, ground - (center.y - radius));
    }
    if (Number.isFinite(lift) && Math.abs(lift) > 0.001) {
      pose.setMatrix({ ...pose.position, y: pose.position.y + lift }, pose.orientation);
      built.root.local.elements[13] += lift;
    }
    if (needsContact) this.settled.set(built, { pose, revision: pose.poseRevision,contacts:contactSignature });
    for (const part of built.world.parts.values()) {
      // Java camera look commands address the installed part, not its chassis.
      // Publish the attachment transform without generating a new placement command.
      const native = part !== built.root && part.nativeId !== undefined
        ? this.nativePart(part.nativeId) : undefined;
      if (native instanceof GameObject) {
        const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
        part.matrix().decompose(position, rotation, scale);
        const angles = new Euler().setFromQuaternion(rotation, 'YXZ');
        native.position = { x: position.x, y: position.y, z: position.z };
        native.orientation = { y: angles.y, p: angles.x, r: angles.z };
      }
      const category = part.definition.config.category ?? 0;
      part.renderVisible = (node.renderFilters.get(category) ?? chassis?.renderFilters.get(category) ?? 0) !== 2;
    }
    this.viewer.syncWorldVisuals(built.world);
    this.synced.set(built, { geometry: runningGearChanged ? this.geometrySignature(built) : geometry,
      steering, pose, revision: pose.poseRevision, filters, terrain: !!this.terrain });
  }

  private nativePart(id: number) {
    // Live GameObjects already have an index. Avoid scanning every resource for
    // every installed part when publishing moving cars' camera attachment poses.
    const indexed = this.result.gameTypes.getById(id);
    return indexed?.resourceId === id ? indexed : this.result.gameTypes.getByResourceId(id);
  }

  /** Mutable inputs only: chassis motion and visibility do not invalidate suspension. */
  private geometrySignature(built: BuiltVehicle): string {
    const root = built.root;
    return JSON.stringify([built.world.experimentalHubGeometry, root.definition.config.wheels,
      built.world.wheelRefs.map(wheel => wheel && [wheel.force, wheel.restLength, wheel.minLength, wheel.maxLength, wheel.radius,
        wheel.arm, wheel.hub, wheel.orientation, wheel.position, wheel.oppositeWheel]),
      [...built.world.parts.values()].map(part => [part.id, part.parent?.id, part.parentSlot, part.ownSlot,
        part === root ? null : part.local.elements, part.wheelFrameOffsetY, part.wheelFrameOffsets,
        [...part.slotPositions], [...part.slotRotations], part.definition.config.slots, part.definition.config.bodies])]);
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
      `${part.node.resourceId}:${part.parentSlot}:${part.ownSlot}:${part.texture?.value}[${visit(part.children)}]`).join(',');
    const chassis = this.result.jvm.get(ref, 'chassis');
    return `${this.result.parts.textureFor?.(chassis)?.value}|${visit(this.result.parts.installedTree(chassis))}`;
  }

  private release(built: BuiltVehicle): void { this.viewer.removeWorld(built.world); built.world.dispose(); }
  dispose(): void {
    this.disposed = true; this.wanted.clear();
    for (const built of this.models.values()) this.release(built);
    this.models.clear();
  }
}

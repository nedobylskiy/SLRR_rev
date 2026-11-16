import { jv, type JavaObject, type JavaValue } from 'slrr-jvm';
import type { Assets } from '../assets';
import { normalizeResourcePackPath } from '../assets';
import { PartFactory } from '../engine/world';
import { poseMatrix } from '../engine/transforms';
import { applyDisplaySteering } from '../engine/display-steering';
import { resetParkedRunningGear, settleParkedSuspension } from '../engine/parked-suspension';
import { Euler, Quaternion, Vector3, Matrix4 } from 'three';
import type { MapTerrain } from '../engine/map-terrain';
import type { BootResult } from '../runtime/game-boot';
import { GameObject } from '../runtime/game-object';
import { RenderObject } from '../runtime/render-object';
import {RACE_COMMANDS} from '../engine/race-driver';
import { javaStockSelection } from '../runtime/java-scene';
import type { Viewer } from './viewer';

type BuiltVehicle = Awaited<ReturnType<PartFactory['stock']>>;

/** Projects vehicles owned by the current Java map, including dealer stock, without driving them. */
export class JavaSceneVehicles {
  private readonly models = new Map<GameObject, BuiltVehicle>();
  private readonly assemblies = new WeakMap<BuiltVehicle, string>();
  private failed = new WeakSet<GameObject>();
  private scene:ReturnType<BootResult['gameTypes']['getResource']>|null=undefined;
  private sceneRevision:number|undefined;
  private epoch=0;
  private wanted = new Set<GameObject>();
  private loading = false;
  private work?:Promise<void>;
  private brains=new Map<GameObject,JavaValue>();
  private boundBrains=new WeakMap<BuiltVehicle,ReturnType<BootResult['gameTypes']['getResource']>>();
  private racers=new Map<BuiltVehicle,{dispose():void}>();
  private excluded?:(ref:JavaValue)=>boolean;
  private disposed = false;
  private terrain?: Pick<MapTerrain, 'height'>;
  private readonly settled = new WeakMap<BuiltVehicle, { pose: GameObject; revision: number; contacts:string }>();
  private readonly synced = new WeakMap<BuiltVehicle, {
    inputs: string; geometry: string; steering: number | undefined; pose: GameObject; revision: number; filters: string; terrain: boolean;
  }>();
  constructor(private readonly result: BootResult, private readonly assets: Assets,
    private readonly viewer: Pick<Viewer, 'showWorld' | 'removeWorld' | 'syncWorldVisuals' | 'calibrationSteering'>&Partial<Pick<Viewer,'profiler'|'bindJavaDriver'|'bindJavaRaceCar'|'vehicleSceneRevision'>>,
    private readonly report: (message: string) => void,
    private readonly factory: Pick<PartFactory, 'stock' | 'syncJavaAssembly'> = new PartFactory(assets)) {}

  update(map: JavaValue | null, terrain?: Pick<MapTerrain, 'height'>,excluded?:(ref:JavaValue)=>boolean): void {
    this.excluded=excluded;
    if(this.viewer.profiler)this.viewer.profiler.measure('Parked vehicles update CPU',()=>this.updateCore(map,terrain));
    else this.updateCore(map,terrain);
  }
  /** Race cars must be visible before the Java loading dialog can finish. */
  async prepare(map:JavaValue,terrain?:Pick<MapTerrain,'height'>,excluded?:(ref:JavaValue)=>boolean){
    do{this.update(map,terrain,excluded);if(!this.work)return;await this.work;}while(!this.disposed);
  }
  private updateCore(map:JavaValue|null,terrain?:Pick<MapTerrain,'height'>):void {
    if (this.disposed) return;
    this.terrain = terrain;
    const { gameTypes, jvm } = this.result;
    const root = map && gameTypes.getResource(map);
    // Java may reuse its City, Bot and car handles for another quick race, while
    // the viewer has already removed all of their render/physics bindings.
    if(root!==this.scene||this.sceneRevision!==this.viewer.vehicleSceneRevision){
      this.scene=root;this.sceneRevision=this.viewer.vehicleSceneRevision;this.epoch++;
      for(const built of this.models.values())this.release(built);
      this.models.clear();this.failed=new WeakSet();
    }
    const vehicles = new Map<GameObject, JavaValue>();
    this.brains.clear();
    let priority: number | undefined;
    const consider = (ref: JavaValue): void => {
      if (!ref?.value || typeof ref.value !== 'object' || !('fields' in ref.value)) return;
      if(this.excluded?.(ref))return;
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
        else {
          consider(value);
          // Race opponents belong to a Bot retained by the active City/Track,
          // rather than directly to a Vehicle field on that section.
          const nested=value.value as JavaObject|null;
          if(nested?.fields instanceof Map){
            const car=nested.fields.get('car'),brain=nested.fields.get('brain');
            // An allocated Bot can legitimately have no car (e.g. demoBot or a
            // rival released after the last race). It must not abort discovery
            // of the live raceBot which occurs later in the section's fields.
            if(car?.value!=null&&typeof car.value==='object'&&'fields' in car.value){
              consider(car);const node=gameTypes.get(car);
              if(node&&brain?.value!=null)this.brains.set(node,brain);
            }
          }
        }
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
      const brain=this.brains.get(node),brainNode=brain?gameTypes.getResource(brain):undefined;
      if (!this.wanted.has(node)||built.world.disposed||this.boundBrains.get(built)!==brainNode) { this.release(built); this.models.delete(node);this.failed.delete(node); }
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
      this.work=this.refresh(edit[0], edit[1], this.models.get(edit[0])!).finally(() => { this.loading = false;this.work=undefined; });
      return;
    }
    const pending = [...vehicles].filter(([node]) => !this.models.has(node) && !this.failed.has(node));
    const next = pending.find(([node]) => node.resourceId === priority) ?? pending[0];
    if (!next) return;
    this.loading = true;
    this.work=this.load(...next).finally(() => { this.loading = false;this.work=undefined; });
  }

  private async refresh(node: GameObject, ref: JavaValue, built: BuiltVehicle): Promise<void> {
    const epoch=this.epoch;
    try {
      const signature = this.signature(ref);
      const selection = await javaStockSelection(this.result, this.assets, built.root.definition.key.pack, ref);
      if (this.disposed || epoch!==this.epoch || !this.wanted.has(node) || built.world.disposed) return;
      await this.factory.syncJavaAssembly(built.root, selection);
      if (this.disposed || epoch!==this.epoch || !this.wanted.has(node) || built.world.disposed) return;
      this.settled.delete(built);
      this.synced.delete(built);
      this.sync(node, built, ref);
      // showWorld skips existing GPU proxies and publishes only new part meshes.
      await this.viewer.showWorld(built.world, this.assets, true, true);
      if (built.world.disposed) this.viewer.removeWorld(built.world);
      else this.assemblies.set(built, signature);
    } catch (error) {
      if (!this.disposed && epoch===this.epoch && this.wanted.has(node)) {
        this.assemblies.set(built, this.signature(ref));
        this.report(`Java vehicle update ${node.alias}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private sync(node: GameObject, built: BuiltVehicle, ref: JavaValue): void {
    if(this.racers.has(built))return;
    const chassisRef=this.result.jvm.get(ref,'chassis');
    const chassis = this.result.gameTypes.get(chassisRef);
    // WheelRef instances can appear/rebind after the assembly was first shown.
    built.world.wheelRefs=built.root.definition.config.wheels.map((_,index)=>this.result.chassis.wheelState(chassisRef,index));
    // Chassis.setState is used for the dealer's rotating display stand.
    const pose = chassis && chassis.poseRevision > node.poseRevision ? chassis : node;
    const steering = this.viewer.calibrationSteering ?? node.steeringInput ?? chassis?.steeringInput;
    const previous = this.synced.get(built);
    // Only four wheel records and the chassis revision are read on an idle poll.
    // A rigid stand rotation must not rebuild the installed-part geometry signature.
    const inputs = JSON.stringify([this.result.parts.visualRevision?.(chassisRef),
      this.result.chassis.updateState(chassisRef)?.revision, built.world.experimentalHubGeometry,
      built.root.definition.config.wheels, built.world.wheelRefs.map(wheel => wheel && [
        wheel.force, wheel.restLength, wheel.minLength, wheel.maxLength, wheel.radius,
        wheel.arm, wheel.hub, wheel.orientation, wheel.position, wheel.oppositeWheel])]);
    const geometry = previous?.inputs === inputs ? previous.geometry : this.geometrySignature(built);
    const filters = JSON.stringify([[...node.renderFilters], [...chassis?.renderFilters ?? []]]);
    const runningGearChanged = !previous || previous.geometry !== geometry || previous.steering !== steering;
    if (!runningGearChanged && previous.pose === pose && previous.revision === pose.poseRevision
      && previous.filters === filters && previous.terrain === !!this.terrain) { previous.inputs = inputs; return; }
    built.root.local.copy(poseMatrix({ position: [pose.position.x, pose.position.y, pose.position.z],
      rotation: [pose.orientation.y, pose.orientation.p, pose.orientation.r] }));
    // Moving the chassis does not change the loaded spring pose or assembly mass.
    if (runningGearChanged) {
      resetParkedRunningGear(built.root);
      if (steering !== undefined) applyDisplaySteering(built.root, steering);
      settleParkedSuspension(built.root, steering);
      built.root.savedVehicleDamage?.wheels.forEach((state,index)=>{
        const slot=built.root.definition.config.slots.find(slot=>slot.type===101+index);
        const wheel=slot&&built.root.children.get(slot.id);
        if(wheel)wheel.local.premultiply(new Matrix4().fromArray(state.damage));
      });
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
    this.synced.set(built, { inputs, geometry: runningGearChanged ? this.geometrySignature(built) : geometry,
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
    const epoch=this.epoch,current=()=>!this.disposed&&epoch===this.epoch&&this.wanted.has(node);
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
      if (!current()) { built.world.dispose(); return; }
      this.sync(node, built, ref);
      await this.viewer.showWorld(built.world, this.assets, true, true);
      if (!current()) { this.release(built); return; }
      const brain=this.brains.get(node);
      if(brain){
        const brainNode=this.result.gameTypes.getResource(brain);
        this.boundBrains.set(built,brainNode);
        const renderCommand=this.result.gameTypes.lastCommand(brain,'renderinstance');
        const driverId=renderCommand&&Number(renderCommand.trim().split(/\s+/)[1]);
        const driver=driverId?this.result.gameTypes.getByResourceId(driverId):undefined;
        if(driver instanceof RenderObject)await this.viewer.bindJavaDriver?.(driver,built.root,this.assets);
        if(!current()){this.release(built);return;}
        const chassis=this.result.gameTypes.get(this.result.jvm.get(ref,'chassis'));
        let publishedRevision=-1;
        const racer=await this.viewer.bindJavaRaceCar?.(built.root,{
          command:()=>this.result.gameTypes.latestCommand(brain,RACE_COMMANDS),
          active:()=>current()&&!!brainNode&&this.result.gameTypes.getResource(brain)===brainNode,
          placement:()=>{
            const pose=chassis&&chassis.poseRevision>node.poseRevision?chassis:node;
            if(pose.poseRevision<=publishedRevision)return;
            publishedRevision=pose.poseRevision;
            return {position:new Vector3(pose.position.x,pose.position.y,pose.position.z),yaw:pose.orientation.y,velocity:new Vector3(pose.velocity.x,pose.velocity.y,pose.velocity.z)};
          },
          motion:(position,yaw,velocity)=>{
            node.setState({x:position.x,y:position.y,z:position.z},{y:yaw,p:0,r:0},{x:velocity.x,y:velocity.y,z:velocity.z},{x:0,y:0,z:0});
            publishedRevision=node.poseRevision;
            this.result.gameTypes.updateTriggerContacts(ref);
          }
        });
        if(racer)this.racers.set(built,racer);
        if(!current()){this.release(built);return;}
      }
      this.models.set(node, built);
    } catch (error) {
      if (built) this.release(built);
      if (current()) {
        this.failed.add(node);
        this.report(`Java vehicle ${node.alias}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private signature(ref: JavaValue): string {
    const chassis = this.result.jvm.get(ref, 'chassis');
    const revision = this.result.parts.visualRevision?.(chassis);
    if (revision !== undefined) return `${this.result.gameTypes.getResource(chassis)?.id}:${revision}`;
    const visit = (nodes: ReturnType<BootResult['parts']['installedTree']>): string => nodes.map(part =>
      `${part.node.resourceId}:${part.parentSlot}:${part.ownSlot}:${part.texture?.value}[${visit(part.children)}]`).join(',');
    return `${this.result.parts.textureFor?.(chassis)?.value}|${visit(this.result.parts.installedTree(chassis))}`;
  }

  private release(built: BuiltVehicle): void { this.racers.get(built)?.dispose();this.racers.delete(built);this.viewer.removeWorld(built.world); built.world.dispose(); }
  dispose(): void {
    this.disposed = true; this.wanted.clear();
    for (const built of this.models.values()) this.release(built);
    this.models.clear();
  }
}

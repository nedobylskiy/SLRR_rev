import { jv, type JavaValue } from 'slrr-jvm';
import { normalizeResourcePackPath } from '../assets';
import type { Assets } from '../assets';
import type { JavaInstalledPart, JavaStockSelection, ResourceKey } from '../engine/world';
import type { BootResult } from './game-boot';
import type { DrivingInput } from '../engine/driving-demo';

export interface JavaTrackScene {
  mapPack: string;
  chassis?: { pack: string; id: number };
  start?: { x: number; y: number; z: number; yaw: number };
}

/** Read the active map and car chosen by GameLogic rather than selecting demo assets in the host UI. */
export function activeJavaTrack(result: BootResult): JavaTrackScene | null {
  const { jvm, gameTypes } = result;
  const field = (object: JavaValue | null, name: string): JavaValue | null => {
    if (!object || object.value == null) return null;
    try { return jvm.get(object, name); } catch { return null; }
  };
  const state = field(jv('class', 'java.game.GameLogic'), 'actualState');
  const map = field(state, 'map');
  const mapNode = map?.value == null ? null : gameTypes.getResource(map);
  if (!mapNode?.resourcePack) return null;
  const mapPack = normalizeResourcePackPath(mapNode.resourcePack);
  const player = field(jv('class', 'java.game.GameLogic'), 'player');
  const car = field(player, 'car');
  const chassis = field(car, 'chassis');
  const chassisNode = chassis?.value == null ? null : gameTypes.getResource(chassis);
  const chassisIdentity = chassisNode ? result.resolveResourceIdentity(chassisNode.typeId) : undefined;
  const chassisKey = chassisIdentity
    ? { pack: normalizeResourcePackPath(chassisIdentity.pack), id: chassisIdentity.id }
    : chassisNode?.resourcePack && chassisNode.typeId > 0
      ? { pack: normalizeResourcePackPath(chassisNode.resourcePack), id: chassisNode.typeId } : undefined;
  const position = field(state, 'posStart');
  const orientation = field(state, 'oriStart');
  const x = Number(field(position, 'x')?.value), y = Number(field(position, 'y')?.value);
  const z = Number(field(position, 'z')?.value), yaw = Number(field(orientation, 'y')?.value);
  const start = position?.value != null && [x, y, z, yaw].every(Number.isFinite)
    ? { x, y, z, yaw } : undefined;
  return { mapPack, chassis: chassisKey, start };
}

/** Read the lists selected by the executed chassis Java, including kit branches. */
export async function javaStockSelection(result: BootResult, assets: Assets, chassisPack: string): Promise<JavaStockSelection> {
  const { jvm } = result;
  const player = jvm.get(jv('class', 'java.game.GameLogic'), 'player');
  const car = jvm.get(player, 'car');
  const chassis = jvm.get(car, 'chassis');
  if (chassis.value == null) throw new Error('Java vehicle has no chassis');
  const values = (name: string): number[] => {
    const field = jvm.get(chassis, name);
    if (field.value == null) return [];
    if (!Array.isArray(field.value)) throw new Error(`Java ${name} is not an array`);
    return field.value.map(value => Number(typeof value === 'object' && value && 'value' in value ? value.value : value))
      .filter(value => Number.isSafeInteger(value) && value > 0);
  };
  const resolve = async (id: number, pack = chassisPack): Promise<ResourceKey> => {
    const identity = result.resolveResourceIdentity(id);
    if (identity) return { pack: normalizeResourcePackPath(identity.pack), id: identity.id };
    const { packPath, id: localId } = await assets.resourceLocation(pack, id);
    return { pack: packPath, id: localId };
  };
  const project = async (native: ReturnType<typeof result.parts.installedTree>[number]): Promise<JavaInstalledPart> => ({
    key: await resolve(native.node.typeId, native.node.resourcePack ?? chassisPack),
    parentSlot: native.parentSlot, ownSlot: native.ownSlot,
    positions: native.positions,
    render: native.renderType ? await resolve(native.renderType, native.node.resourcePack ?? chassisPack) : undefined,
    wear: native.wear,
    children: await Promise.all(native.children.map(project)),
  });
  const installed = await Promise.all(result.parts.installedTree(chassis).map(project));
  const bodyLists = ['E', 'FL', 'FR', 'RL', 'RR', 'F', 'Rr', 'L', 'R', 'T'];
  const mechanicalLists = ['suspensions', 'shocks', 'springs', 'brakes', 'sways', 'wheels', 'others'];
  const body = await Promise.all(bodyLists.flatMap(name => values(`parts_list_${name}`)).map(id => resolve(id)));
  const mechanical = await Promise.all(mechanicalLists.flatMap(name => values(`parts_list_RGear_${name}`)).map(id => resolve(id)));
  const tyreIds = values('parts_list_RGear_tyres');
  const tyres = await Promise.all(tyreIds.map(id => resolve(id)));
  if (values('parts_list_RGear_wheels').length !== 4 || values('parts_list_RGear_suspensions').length !== 4)
    throw new Error('Executed Java chassis did not select four wheels and four suspensions');
  const wheelRefs = Array.from({ length: 4 }, (_, index) => result.chassis.wheelState(chassis, index));
  return { body, mechanical, tyres, wheelRefs, installed, rootPositions: result.parts.slotOverrides(chassis) };
}

/** Vehicle controls come from the ControlSet bindings installed by the active Java Player. */
export function javaDrivingControls(result: BootResult): { sample(): DrivingInput; cameraMode(): number; cameraIndex(): number; cameraDistance(): number;
  mouseButton(pressed: boolean): void; mouseMotion(dx: number, dy: number): void; cameraLook(): { x: number; y: number } } {
  const { jvm, controllers, gameTypes, input } = result;
  const activeState = () => jvm.get(jv('class', 'java.game.GameLogic'), 'actualState');
  const controller = () => {
    const player = jvm.get(jv('class', 'java.game.GameLogic'), 'player');
    return player.value == null ? null : jvm.get(player, 'controller');
  };
  return {
    sample() {
      const current = controller();
      const axis = (id: number) => current?.value == null ? 0 : controllers.read(current, id);
      const gear = axis(50);
      return { throttle: Math.max(0, axis(28)), steer: Math.max(-1, Math.min(1, axis(1))),
        brake: axis(29) > 0.2 || axis(48) > 0.2, clutch: axis(49) > 0.2,
        gearUp: gear > 0.2, gearDown: gear < -0.2 };
    },
    cameraMode() {
      const state = activeState();
      return state.value == null ? 1 : Number(jvm.get(state, 'cameraMode').value) || 1;
    },
    cameraIndex() {
      const state = activeState();
      return state.value == null ? 0 : Number(jvm.get(state, 'cameraNum').value) || 0;
    },
    cameraDistance() {
      const state = activeState();
      if (state.value == null) return 7;
      const camera = jvm.get(state, 'cam');
      if (camera.value == null) return 7;
      const command = gameTypes.lastCommand(camera, 'dist');
      const values = command?.split(/\s+/).slice(1).map(Number) ?? [];
      return values.length === 2 && values.every(Number.isFinite)
        ? Math.max(values[0], Math.min(values[1], 7)) : 7;
    },
    mouseButton(pressed) { input.setPhysicalAxis(1, 4, pressed ? 1 : 0); },
    mouseMotion(dx, dy) {
      input.setPhysicalAxis(1, 0, Math.max(-1, Math.min(1, input.physicalAxis(1, 0) + dx * 0.01)));
      input.setPhysicalAxis(1, 1, Math.max(-1, Math.min(1, input.physicalAxis(1, 1) + dy * 0.01)));
    },
    cameraLook() {
      const current = controller();
      const x = current?.value == null ? 0 : controllers.read(current, 7);
      const y = current?.value == null ? 0 : controllers.read(current, 8);
      input.setPhysicalAxis(1, 0, 0);
      input.setPhysicalAxis(1, 1, 0);
      return { x, y };
    },
  };
}

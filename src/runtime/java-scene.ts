import { jv, type JavaValue } from 'slrr-jvm';
import { normalizeResourcePackPath } from '../assets';
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
  const chassisKey = chassisNode?.resourcePack && chassisNode.typeId > 0
    ? { pack: normalizeResourcePackPath(chassisNode.resourcePack), id: chassisNode.typeId } : undefined;
  const position = field(state, 'posStart');
  const orientation = field(state, 'oriStart');
  const x = Number(field(position, 'x')?.value), y = Number(field(position, 'y')?.value);
  const z = Number(field(position, 'z')?.value), yaw = Number(field(orientation, 'y')?.value);
  const start = position?.value != null && [x, y, z, yaw].every(Number.isFinite)
    ? { x, y, z, yaw } : undefined;
  return { mapPack, chassis: chassisKey, start };
}

/** Vehicle controls come from the ControlSet bindings installed by the active Java Player. */
export function javaDrivingControls(result: BootResult): { sample(): DrivingInput; cameraMode(): number; cameraDistance(): number } {
  const { jvm, controllers, gameTypes } = result;
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
  };
}

import { Euler, Quaternion, Vector3 } from 'three';
import { jv, type JavaValue } from 'slrr-jvm';
import type { BootResult } from './game-boot';
import { GameObject } from './game-object';

export interface JavaSceneCamera {
  id: number; position: Vector3; target: Vector3;
  fov: number; near: number; far: number; smoothing: number;
}

/** Native camera command adapter for non-driving Java sections; no menu-specific camera presets. */
export function javaSceneCamera(result: BootResult): JavaSceneCamera | null {
  const { jvm, gameTypes } = result;
  const field = (value: JavaValue, name: string): JavaValue | undefined => {
    try { return jvm.get(value, name); } catch { return undefined; }
  };
  const state = field(jv('class', 'java.game.GameLogic'), 'actualState');
  if (!state?.value || jvm.isInstance(state, 'java.game.Track')) return null;
  const ref = [field(state, 'cam'), field(state, 'camera')].find(value => value?.value != null);
  if (!ref) return null;
  const camera = gameTypes.get(ref);
  if (!camera?.cameraRendering) return null;
  const command = (name: string) => gameTypes.lastCommand(ref, name)?.trim().split(/\s+/).slice(1) ?? [];
  const number = (name: string, fallback: number) => {
    const value = Number(command(name)[0]); return Number.isFinite(value) ? value : fallback;
  };
  const targetOf = (verb: string): Vector3 | undefined => {
    const source = gameTypes.lastCommand(ref, verb);
    const match = source && /^\S+\s+(\S+)\s+([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)/.exec(source.trim());
    if (!match) return;
    const target = gameTypes.getByResourceId(Number(match[1]));
    if (!(target instanceof GameObject)) return;
    const values = match.slice(2).map(Number);
    if (!values.every(Number.isFinite)) return;
    return new Vector3(...values).applyQuaternion(new Quaternion().setFromEuler(
      new Euler(target.orientation.p, target.orientation.y, target.orientation.r, 'YXZ')))
      .add(new Vector3(target.position.x, target.position.y, target.position.z));
  };
  const position = new Vector3(camera.position.x, camera.position.y, camera.position.z);
  const follow = targetOf('move');
  if (follow) {
    const offset = position.clone().sub(follow); offset.y = 0;
    if (offset.lengthSq() < 1e-8) offset.set(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), camera.orientation.y);
    const range = command('dist').slice(0, 2).map(Number);
    const distance = range.length === 2 && range.every(Number.isFinite) && range[0] > 0 && range[1] >= range[0]
      ? Math.max(range[0], Math.min(range[1], offset.length())) : offset.length();
    offset.normalize().multiplyScalar(distance);
    position.copy(follow).add(offset);
    position.y = follow.y + number('height', Math.max(0.1, camera.position.y - follow.y));
  }
  const target = targetOf('look') ?? position.clone().add(new Vector3(0, 0, -1).applyEuler(
    new Euler(camera.orientation.p, camera.orientation.y, camera.orientation.r, 'YXZ')));
  const fov = number('zoom', 60), near = Math.max(0.001, number('nearplane', 0.05)), far = number('farplane', 1000);
  return { id: camera.resourceId, position, target, fov: Math.max(1, Math.min(179, fov)),
    near, far: Math.max(near + 1, far), smoothing: Math.max(0, number('smooth', 0)) };
}

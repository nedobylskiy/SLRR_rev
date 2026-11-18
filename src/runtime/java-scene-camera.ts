import { Euler, Quaternion, Vector3 } from 'three';
import { jv, type JavaValue } from 'slrr-jvm';
import type { BootResult } from './game-boot';
import { GameObject } from './game-object';

export interface JavaSceneCamera {
  id: number; position: Vector3; target: Vector3;
  fov: number; near: number; far: number; smoothing: number;
}
const controlledPoses = new WeakMap<GameObject, { revision: number; commands: string; offset: Vector3 }>();
const rotations = new WeakMap<GameObject, { command: string; started: number; azimuth: number }>();
const moveOffsets = new WeakMap<GameObject, { revision: number; command: string; offset: Vector3 }>();

/** Java scene cameras, with optional scripted overrides of the normal driving camera. */
export function javaSceneCamera(result: BootResult, includeDriving = false, now = performance.now()): JavaSceneCamera | null {
  const { jvm, gameTypes } = result;
  const field = (value: JavaValue, name: string): JavaValue | undefined => {
    try { return jvm.get(value, name); } catch { return undefined; }
  };
  const state = field(jv('class', 'java.game.GameLogic'), 'actualState');
  if (!state?.value) return null;
  const driving = jvm.isInstance(state, 'java.game.Track');
  if (driving && !includeDriving) return null;
  const mode = Number(field(state, 'cameraMode')?.value ?? 1);
  if (driving && mode === 5) return null; // The CFG cockpit camera remains vehicle-owned.
  const ref = [field(state, 'cam'), field(state, 'camera')].find(value => value?.value != null);
  if (!ref) return null;
  const camera = gameTypes.get(ref);
  if (!camera?.cameraRendering) return null;
  const command = (name: string) => gameTypes.lastCommand(ref, name)?.trim().split(/\s+/).slice(1) ?? [];
  const number = (name: string, fallback: number) => {
    const value = Number(command(name)[0]); return Number.isFinite(value) ? value : fallback;
  };
  const selected = field(state, 'cameraTarget');
  const selectedNode = selected && gameTypes.get(selected);
  const angleCommand = gameTypes.lastCommand(ref, 'angle') ?? '';
  const angle = command('angle').map(Number);
  // changeCamFollow reuses cam_external. Its force command replaces a previous
  // scripted orbit; an old angle must not take the player camera over again.
  const rotating = angle.length >= 2 && angle.every(Number.isFinite) && angle[1] > 0
    && gameTypes.latestCommand(ref,['angle','force','move'])===angleCommand;
  if (!rotating) rotations.delete(camera);
  if (driving && mode === 1 && !rotating) {
    const player = field(jv('class', 'java.game.GameLogic'), 'player');
    const playerCar = player && field(player, 'car');
    if (!selectedNode || playerCar && gameTypes.get(playerCar) === selectedNode) return null;
  }
  const targetOf = (verb: string, attachment = false): Vector3 | undefined => {
    const source = gameTypes.lastCommand(ref, verb);
    const match = source && /^\S+\s+(\S+)\s+([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)/.exec(source.trim());
    if (!match) return;
    const target = gameTypes.getByResourceId(Number(match[1]));
    if (!(target instanceof GameObject)) return;
    const values = match.slice(2).map(Number);
    if (!values.every(Number.isFinite)) return;
    // Track.changeCamChase uses move <bone> <offset> .01 <attachment>.
    // The last vector is a car-local camera mount, not an orbit distance.
    if (attachment) {
      const tail = source!.trim().slice(match[0].length).trim();
      const mount = /^([\d.eE+-]+)\s+([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)/.exec(tail);
      if (!mount || Number(mount[1]) > .25) return;
      for (let i = 0; i < 3; i++) values[i] += Number(mount[i + 2]);
    }
    return new Vector3(...values).applyQuaternion(new Quaternion().setFromEuler(
      new Euler(target.orientation.p, target.orientation.y, target.orientation.r, 'YXZ')))
      .add(new Vector3(target.position.x, target.position.y, target.position.z));
  };
  const position = new Vector3(camera.position.x, camera.position.y, camera.position.z);
  const selectedPosition = selectedNode instanceof GameObject
    ? new Vector3(selectedNode.position.x, selectedNode.position.y, selectedNode.position.z) : undefined;
  const follow = driving && mode === 6 ? undefined
    : driving && mode === 1 ? selectedPosition : targetOf('move');
  const mount = driving && (mode === 3 || mode === 4) ? targetOf('move', true) : undefined;
  if (mount) position.copy(mount);
  else if (follow) {
    const moveCommand = gameTypes.lastCommand(ref, 'move') ?? '';
    let remembered = moveOffsets.get(camera);
    if (!remembered || remembered.revision !== camera.poseRevision || remembered.command !== moveCommand) {
      remembered = { revision: camera.poseRevision, command: moveCommand, offset: position.clone().sub(follow) };
      moveOffsets.set(camera, remembered);
    }
    // Keep the initial offset: recomputing eye - moving target each frame
    // cancels all target translation and leaves the camera at its old junction.
    const offset = remembered.offset.clone(); offset.y = 0;
    if (driving && mode === 1) offset.set(0,0,7).applyAxisAngle(new Vector3(0,1,0),selectedNode?.orientation.y ?? 0);
    if (offset.lengthSq() < 1e-8) offset.set(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), camera.orientation.y);
    const range = command('dist').slice(0, 2).map(Number);
    const distance = range.length === 2 && range.every(Number.isFinite) && range[0] > 0 && range[1] >= range[0]
      ? Math.max(range[0], Math.min(range[1], offset.length())) : offset.length();
    offset.normalize().multiplyScalar(distance);
    position.copy(follow).add(offset);
    position.y = follow.y + number('height', driving ? 2.5 : Math.max(0.1, remembered.offset.y));
  }
  const lookTarget = driving && mode === 6 ? undefined
    : driving && mode === 1 ? selectedPosition?.clone().add(new Vector3(0,1.1,0)) : targetOf('look');
  const target = lookTarget ?? position.clone().add(new Vector3(0, 0, -1).applyEuler(
    new Euler(camera.orientation.p, camera.orientation.y, camera.orientation.r, 'YXZ')));
  const poseCommands = [selectedNode?.resourceId, ...['move', 'look', 'dist', 'height', 'angle'].map(name => gameTypes.lastCommand(ref, name))].join('|');
  const controlledPose = controlledPoses.get(camera);
  if (lookTarget && controlledPose?.revision === camera.poseRevision && controlledPose.commands === poseCommands)
    position.copy(target).add(controlledPose.offset);
  if (rotating && lookTarget) {
    let rotation = rotations.get(camera);
    const offset = position.clone().sub(target);
    if (!rotation || rotation.command !== angleCommand) {
      rotation = { command: angleCommand, started: now, azimuth: Math.atan2(offset.x,offset.z) + angle[0] };
      rotations.set(camera,rotation);
    }
    const azimuth = rotation.azimuth + (now-rotation.started)/1000 * Math.PI*2/angle[1];
    const elevation = angle[2] ?? Math.atan2(offset.y,Math.hypot(offset.x,offset.z));
    const radius = Math.max(.1,offset.length());
    position.copy(target).add(new Vector3(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)).multiplyScalar(radius));
    controlledPoses.delete(camera);
  } else rotations.delete(camera);
  const motion = result.input?.sceneCameraMotion(ref);
  if (motion && (motion.x || motion.y || motion.zoom)) {
    // Native camera control consumes the mappings installed by MouseCursor's
    // Java drag handler. Preserve the script's target and distance constraints.
    if (!lookTarget) {
      const orientation = { y: camera.orientation.y - motion.x * 0.3,
        p: Math.max(-1.4, Math.min(1.4, camera.orientation.p - motion.y * 0.3)), r: camera.orientation.r };
      const forward = new Vector3(0, 0, -1).applyEuler(new Euler(orientation.p, orientation.y, orientation.r, 'YXZ'));
      position.addScaledVector(forward, -motion.zoom * 0.5);
      target.copy(position).add(forward);
      camera.setMatrix({ x: position.x, y: position.y, z: position.z }, orientation);
    } else {
    const offset = position.clone().sub(target), radius = Math.max(0.1, offset.length());
    const azimuth = Math.atan2(offset.x, offset.z) - motion.x * 0.3;
    const elevation = Math.max(-1.4, Math.min(1.4, Math.asin(offset.y / radius) + motion.y * 0.3));
    const range = command('dist').slice(0, 2).map(Number);
    const minimum = range[0] > 0 ? range[0] : 0.5;
    const maximum = range[1] >= minimum ? range[1] : Infinity;
    const distance = Math.max(minimum, Math.min(maximum, radius + motion.zoom * 0.5));
    offset.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
    position.copy(target).addScaledVector(offset, distance);
    camera.setMatrix({ x: position.x, y: position.y, z: position.z }, {
      y: azimuth, p: -elevation, r: 0,
    });
    controlledPoses.set(camera, { revision: camera.poseRevision, commands: poseCommands, offset: position.clone().sub(target) });
    }
  }
  const fov = number('zoom', 60), near = Math.max(0.001, number('nearplane', 0.05)), far = number('farplane', 1000);
  return { id: camera.resourceId, position, target, fov: Math.max(1, Math.min(179, fov)),
    near, far: Math.max(near + 1, far), smoothing: Math.max(0, number('smooth', 0)) };
}

import type { GameObject, Vector3State } from './game-object';

/** The host physics publishes the player's car pose to Java with setState every
 * step. A different pose revision therefore means Java itself moved the car
 * (GameRef.setMatrix, e.g. City.startNightRace's start line), which the
 * physics must adopt instead of overwriting on its next step. */
export function javaPlacementWatcher(node: GameObject | undefined) {
  let own = node?.poseRevision ?? 0;
  return {
    /** Call after writing the physics pose into Java. */
    published(): void { if (node) own = node.poseRevision; },
    placement(): { position: Vector3State; yaw: number } | undefined {
      if (!node || node.poseRevision === own) return;
      own = node.poseRevision;
      return { position: { ...node.position }, yaw: node.orientation.y };
    },
  };
}

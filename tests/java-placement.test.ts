import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameObject } from '../src/runtime/game-object';
import { javaPlacementWatcher } from '../src/runtime/java-placement';

test('Java setMatrix on the driven player car is adopted once; the physics own setState is not', () => {
  const car = new GameObject(1, 'java.game.Vehicle', 6, null, 'player car');
  car.setMatrix({ x: 1, y: 2, z: 3 }, { y: 0, p: 0, r: 0 }); // initial load, already used as the spawn
  const watcher = javaPlacementWatcher(car);
  assert.equal(watcher.placement(), undefined, 'the spawn pose is not applied a second time');
  // Every physics step publishes its pose to Java.
  car.setState({ x: 5, y: 2, z: 3 }, { y: .1, p: 0, r: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  watcher.published();
  assert.equal(watcher.placement(), undefined, 'the physics own motion is not a Java placement');
  // City.startNightRace: player.car.setMatrix(start, oriS); command("stop").
  car.setMatrix({ x: 100, y: 0, z: -40 }, { y: 1.5, p: 0, r: 0 });
  assert.deepEqual(watcher.placement(), { position: { x: 100, y: 0, z: -40 }, yaw: 1.5 });
  assert.equal(watcher.placement(), undefined, 'one placement per Java setMatrix');
  assert.equal(javaPlacementWatcher(undefined).placement(), undefined);
});

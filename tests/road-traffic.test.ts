import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Vector3 } from 'three';
import { RoadTrafficCar, trafficConnections } from '../src/engine/road-traffic';
import { parsePartConfig } from '../src/formats/cfg';
import type { RoadNetwork, RoadOther, RoadPoint, RoadSegment } from '../src/formats/trc';

function segment(start: RoadPoint, end: RoadPoint): RoadSegment {
  const tangent = end.map((v, i) => v - start[i]) as RoadPoint;
  return { start, end, startTangent: tangent, endTangent: tangent, length: Math.hypot(...tangent), raw: new Uint32Array(14), flag: 0 };
}
function road(id: number, start: RoadPoint, end: RoadPoint): RoadOther {
  return { id, refs: [id + 100, 0], raw: new Uint32Array(12), flag: 0, extraRefs: [], tail: new Uint32Array(3), segments: [segment(start, end)] };
}
function junction(): RoadNetwork {
  return { version: 1, bytes: 0, paths: [], others: [road(2, [0, 0, 0], [-10, 0, 0]), road(3, [102, 0, 2], [2, 0, 2]), road(4, [-2, 0, 102], [-2, 0, 2]), road(5, [102, 0, 2], [2, 0, 2])],
    nodes: [{ id: 1, group: 1, position: [0, 0, 0], raw: new Uint32Array(4),
      links: [{ target: 2, flag: 1 }, { target: 3, flag: 0 }, { target: 4, flag: 0 }],
      lanes: [{ header: new Uint8Array(12), segment: segment([2, 0, 2], [0, 0, 0]) }, { header: new Uint8Array(12), segment: segment([-2, 0, 2], [0, 0, 0]) }] }] };
}

test('traffic joins only explicit crossing links and follows grey curves in reverse', () => {
  const network = junction(), turns = trafficConnections(network).get(2)!;
  assert.deepEqual(turns.map(turn => turn.outgoing), [3, 4]); // road 5 overlaps, but is not linked
  const car = new RoadTrafficCar(network, new Vector3(-10, 0, 0), () => 0);
  assert.deepEqual(car.position.toArray(), [-10, 0, 0]); assert.ok(car.direction.x > .999);
  let sawCrossing = false; const previous = car.position.clone();
  for (let i = 0; i < 50; i++) {
    car.advance(.1); sawCrossing ||= car.phase.startsWith('crossing');
    assert.ok(previous.distanceTo(car.position) <= 15 / 3.6 * .1 + 1e-8); previous.copy(car.position);
  }
  assert.equal(sawCrossing, true); assert.equal(car.crossingsPassed, 1); assert.equal(car.roadId, 3);
  assert.ok(Math.abs(car.position.z - 2) < 1e-8); assert.ok(car.direction.x > .999);
  assert.ok(Math.abs(car.travelled - 15 / 3.6 * 5) < 1e-8);
});

test('random exit is selected once on approach, with different branches available', () => {
  let calls = 0;
  const car = new RoadTrafficCar(junction(), new Vector3(-10, 0, 0), () => { calls++; return .999; });
  car.advance(.1); assert.equal(car.nextRoad, 4); const selectedCalls = calls;
  for (let i = 0; i < 10; i++) car.advance(.1);
  assert.equal(calls, selectedCalls);
  for (let i = 0; i < 40; i++) car.advance(.1);
  assert.equal(car.roadId, 4); assert.equal(car.crossingsPassed, 1);
});

test('missing connected exit stops rather than jumping to another street; long frames stay bounded', () => {
  const network = junction(); network.others[1] = road(3, [3, 0, 2], [2, 0, 2]);
  const car = new RoadTrafficCar(network, new Vector3(-10, 0, 0), () => 0);
  car.advance(100); assert.ok(car.travelled <= car.speed * .25 + 1e-8);
  for (let i = 0; i < 200; i++) car.advance(.1);
  assert.equal(car.stopped, true); assert.deepEqual(car.position.toArray(), [3, 0, 2]);
  const at = car.position.clone(); car.advance(.1); assert.ok(car.position.equals(at));
  const disconnected = junction(); disconnected.nodes = [];
  assert.throws(() => new RoadTrafficCar(disconnected), /No connected/);
});

test('inline traffic wheel render keeps its resource and local orientation', () => {
  const config = parsePartConfig('render 0x1\ntype 10 sphere 0.36\nwheel 1 -0.7 2 0 0 0 1 0 1 0\nrender 0xa 0 0 0 3.142 0 0\nlod 1 2\ntype 10 sphere 0.36\nwheel -1 -0.7 2 0 0 0 1 0 1 0\nrender 0xb 0 0 0 0 0 0');
  assert.equal(config.wheels[0].render?.resource, 10); assert.equal(config.wheels[0].render?.pose?.rotation[0], 3.142);
  assert.equal(config.wheels[1].render?.resource, 11); assert.equal(config.render, 1);
});

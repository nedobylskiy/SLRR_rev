import { Vector3 } from 'three';
import { sampleRoadSegment, type RoadNetwork, type RoadOther, type RoadSegment } from '../formats/trc';

const JOIN_TOLERANCE = .03;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
export interface TrafficTurn { crossing: number; outgoing: number; branch: number; segment: RoadSegment }

/** Geometry joins are checked only among the explicit links of the same TRC crossing. */
export function trafficConnections(network: RoadNetwork): Map<number, TrafficTurn[]> {
  const roads = new Map(network.others.map(road => [road.id, road]));
  const result = new Map<number, TrafficTurn[]>();
  for (const node of network.nodes) {
    const linked = node.links.map(link => roads.get(link.target)).filter((road): road is RoadOther => !!road);
    for (const incoming of linked) {
      const green = incoming.segments[0].start;
      for (const lane of node.lanes) {
        // Actual traffic reverses both blue road records and these connecting grey curves.
        if (distance(green, lane.segment.end) > JOIN_TOLERANCE) continue;
        for (const outgoing of linked) {
          if (incoming.id === outgoing.id || distance(lane.segment.start, outgoing.segments.at(-1)!.end) > JOIN_TOLERANCE) continue;
          let turns = result.get(incoming.id); if (!turns) result.set(incoming.id, turns = []);
          turns.push({ crossing: node.id, outgoing: outgoing.id, branch: outgoing.refs[0] || outgoing.id, segment: lane.segment });
        }
      }
    }
  }
  return result;
}

/** Arc-length lookup for constant world speed, always in reverse stored order. */
class TrafficCurve {
  points: Vector3[] = [];
  distances: number[] = [];
  length = 0;
  constructor(segments: RoadSegment[]) {
    for (const segment of [...segments].reverse()) {
      const steps = Math.max(12, Math.min(256, Math.ceil(segment.length / 1.5)));
      for (let i = 0; i <= steps; i++) {
        const point = new Vector3(...sampleRoadSegment(segment, 1 - i / steps));
        const previous = this.points.at(-1);
        if (previous && i === 0 && previous.distanceTo(point) > JOIN_TOLERANCE) throw Error('Discontinuous traffic spline');
        const step = previous?.distanceTo(point) ?? 0;
        if (previous && step < 1e-7) continue;
        this.length += step; this.points.push(point); this.distances.push(this.length);
      }
    }
    if (this.points.length < 2) throw Error('Empty traffic spline');
  }
  sample(at: number, position: Vector3, direction: Vector3) {
    at = Math.max(0, Math.min(this.length, at)); let low = 1, high = this.points.length - 1;
    while (low < high) { const middle = (low + high) >>> 1; if (this.distances[middle] < at) low = middle + 1; else high = middle; }
    const a = this.points[low - 1], b = this.points[low];
    position.copy(a).lerp(b, (at - this.distances[low - 1]) / (this.distances[low] - this.distances[low - 1]));
    direction.copy(b).sub(a).normalize();
  }
  nearest(point: Vector3) {
    let best = Infinity, at = 0;
    const delta = new Vector3(), projected = new Vector3();
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i]; delta.copy(b).sub(a);
      const t = Math.max(0, Math.min(1, projected.copy(point).sub(a).dot(delta) / delta.lengthSq()));
      projected.copy(a).addScaledVector(delta, t); const d = projected.distanceToSquared(point);
      if (d < best) { best = d; at = this.distances[i - 1] + t * (this.distances[i] - this.distances[i - 1]); }
    }
    return { distance: best, at };
  }
}

/** One kinematic traffic experiment. No new physics bodies, collision or signal policy. */
export class RoadTrafficCar {
  readonly speed = 15 / 3.6;
  readonly position = new Vector3();
  readonly direction = new Vector3();
  readonly connections: Map<number, TrafficTurn[]>;
  private curves = new Map<number, TrafficCurve>();
  private curve: TrafficCurve;
  private at = 0;
  private pending?: TrafficTurn;
  private crossingTurn?: TrafficTurn;
  roadId = 0;
  crossingsPassed = 0;
  travelled = 0;
  stopped = false;
  constructor(network: RoadNetwork, spawn = new Vector3(), private random = Math.random) {
    this.connections = trafficConnections(network);
    for (const road of network.others) this.curves.set(road.id, new TrafficCurve(road.segments));
    let nearest = Infinity;
    for (const [id, curve] of this.curves) {
      if (!this.connections.get(id)?.length) continue;
      const candidate = curve.nearest(spawn);
      if (candidate.distance < nearest) { nearest = candidate.distance; this.roadId = id; this.at = candidate.at; }
    }
    const curve = this.curves.get(this.roadId); if (!curve) throw Error('No connected traffic road near spawn');
    this.curve = curve; this.curve.sample(this.at, this.position, this.direction);
  }
  get phase() { return this.crossingTurn ? `crossing #${this.crossingTurn.crossing}` : `road #${this.roadId}`; }
  get nextRoad() { return this.pending?.outgoing; }
  private chooseTurn() {
    const turns = this.connections.get(this.roadId) ?? [];
    const branches = [...new Set(turns.map(turn => turn.branch))]; if (!branches.length) return;
    const pick = <T>(items: T[]) => items[Math.min(items.length - 1, Math.max(0, Math.floor(this.random() * items.length)))];
    const branch = pick(branches); return pick(turns.filter(turn => turn.branch === branch));
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.stopped) return;
    let remaining = Math.min(seconds, .25) * this.speed;
    for (let transition = 0; remaining > 0 && transition < 16; transition++) {
      if (!this.crossingTurn && !this.pending && this.curve.length - this.at <= 15) this.pending = this.chooseTurn();
      const step = Math.min(remaining, this.curve.length - this.at); this.at += step; remaining -= step; this.travelled += step;
      if (this.at < this.curve.length - 1e-8) break;
      if (this.crossingTurn) {
        this.roadId = this.crossingTurn.outgoing; this.curve = this.curves.get(this.roadId)!;
        this.crossingTurn = undefined; this.crossingsPassed++;
      } else {
        const turn = this.pending ?? this.chooseTurn(); this.pending = undefined;
        if (!turn) { this.stopped = true; break; }
        this.crossingTurn = turn; this.curve = new TrafficCurve([turn.segment]);
      }
      this.at = 0;
    }
    this.curve.sample(this.at, this.position, this.direction);
  }
}

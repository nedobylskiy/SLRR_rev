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
  nearest(point: Vector3, planar=false) {
    let best = Infinity, at = 0;
    const delta = new Vector3(), projected = new Vector3();
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i]; delta.copy(b).sub(a);if(planar)delta.y=0;
      const t = Math.max(0, Math.min(1, projected.copy(point).sub(a).dot(delta) / delta.lengthSq()));
      projected.copy(a).addScaledVector(delta, t);if(planar)projected.y=point.y;const d = projected.distanceToSquared(point);
      if (d < best) { best = d; at = this.distances[i - 1] + t * (this.distances[i] - this.distances[i - 1]); }
    }
    return { distance: best, at };
  }
}
const graphs = new WeakMap<RoadNetwork, { connections: Map<number, TrafficTurn[]>; curves: Map<number, TrafficCurve> }>();
const speedGroups=new WeakMap<RoadNetwork,Map<number,0|1>>();
/** Either yellow endpoint selects the rural regime for the whole road. */
export function trafficRoadSpeedGroups(network:RoadNetwork){
  let groups=speedGroups.get(network);if(groups)return groups;
  groups=new Map();const roads=new Set(network.others.map(road=>road.id));
  for(const node of network.nodes)for(const link of node.links)if(roads.has(link.target)){
    groups.set(link.target,node.group===0||groups.get(link.target)===0?0:1);
  }
  speedGroups.set(network,groups);return groups;
}
const turns=new WeakMap<RoadSegment,TrafficCurve>();
function crossingCurve(segment:RoadSegment){let curve=turns.get(segment);if(!curve){curve=new TrafficCurve([segment]);turns.set(segment,curve);}return curve;}

/** Per-car navigation cursor over a shared road graph; no physics or signal policy. */
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
  private previousTurn?:TrafficTurn;
  private laneChange?:{source:TrafficCurve;start:number;length:number};
  lastCrossingGroup?:0|1;
  roadId = 0;
  crossingsPassed = 0;
  travelled = 0;
  get speedGroup(){return trafficRoadSpeedGroups(this.network).get(this.roadId);}
  stopped = false;
  constructor(private network: RoadNetwork, spawn = new Vector3(), private random = Math.random, roadId?:number) {
    let graph=graphs.get(network);
    if(!graph){graph={connections:trafficConnections(network),curves:new Map(network.others.map(road=>[road.id,new TrafficCurve(road.segments)]))};graphs.set(network,graph);}
    this.connections = graph.connections;this.curves=graph.curves;
    this.curve = this.curves.values().next().value!;
    if(roadId!==undefined&&this.curves.has(roadId)&&this.connections.get(roadId)?.length){this.roadId=roadId;this.curve=this.curves.get(roadId)!;this.at=this.curve.nearest(spawn,true).at;this.curve.sample(this.at,this.position,this.direction);}
    else this.rejoin(spawn);
  }
  /** Place an independent cursor upstream on this lane, including explicit crossing connections. */
  spawnBehind(metres:number,random=Math.random):RoadTrafficCar {
    if(!Number.isFinite(metres)||metres<0)throw Error('Invalid traffic following distance');
    const car=new RoadTrafficCar(this.network,this.position,random);
    car.roadId=this.roadId;car.curve=this.curve;car.at=this.at;car.crossingTurn=this.crossingTurn;car.pending=undefined;
    let remaining=metres;
    for(let i=0;remaining>car.at&&i<32;i++){
      remaining-=car.at;
      if(car.crossingTurn){car.crossingTurn=undefined;car.curve=car.curves.get(car.roadId)!;}
      else{
        const previous=[...car.connections].flatMap(([incoming,turns])=>turns.filter(turn=>turn.outgoing===car.roadId).map(turn=>({incoming,turn})))[0];
        if(!previous)throw Error('No connected upstream road for traffic spawn');
        car.roadId=previous.incoming;car.crossingTurn=previous.turn;car.curve=crossingCurve(previous.turn.segment);
      }
      car.at=car.curve.length;
    }
    if(remaining>car.at)throw Error('Traffic spawn exceeds upstream traversal limit');
    car.at-=remaining;car.curve.sample(car.at,car.position,car.direction);return car;
  }
  /** Rebind navigation only; never moves a physical vehicle. Graph buffers are shared. */
  rejoin(spawn:Vector3) {
    let nearest = Infinity;
    for (const [id, curve] of this.curves) {
      if (!this.connections.get(id)?.length) continue;
      const candidate = curve.nearest(spawn);
      if (candidate.distance < nearest) { nearest = candidate.distance; this.roadId = id; this.at = candidate.at; }
    }
    const curve = this.curves.get(this.roadId); if (!curve) throw Error('No connected traffic road near spawn');
    this.curve = curve;this.pending=this.crossingTurn=this.previousTurn=undefined;this.laneChange=undefined;this.stopped=false;
    this.curve.sample(this.at, this.position, this.direction);
  }
  targetAhead(distance:number,position:Vector3,direction:Vector3){
    if(this.laneChange){this.sampleLaneChange(this.at+distance,position,direction);return;}
    if(!this.crossingTurn&&!this.pending&&this.curve.length-this.at<=Math.max(15,distance))this.pending=this.chooseTurn();
    const sample=this.at+distance;
    if(sample<0){
      if(this.crossingTurn){this.curves.get(this.roadId)!.sample(this.curves.get(this.roadId)!.length+sample,position,direction);return;}
      if(this.previousTurn?.outgoing===this.roadId){const curve=crossingCurve(this.previousTurn.segment);curve.sample(curve.length+sample,position,direction);return;}
    }
    if(sample>this.curve.length&&this.crossingTurn){this.curves.get(this.crossingTurn.outgoing)!.sample(sample-this.curve.length,position,direction);return;}
    if(sample>this.curve.length&&this.pending){const curve=crossingCurve(this.pending.segment),offset=sample-this.curve.length;if(offset>curve.length)this.curves.get(this.pending.outgoing)!.sample(offset-curve.length,position,direction);else curve.sample(offset,position,direction);return;}
    this.curve.sample(sample,position,direction);
  }
  /** Blend steering samples across actual connected joins. Navigation/signal progress keeps the original graph. */
  steeringTargetAhead(distance:number,window:number,position:Vector3,direction:Vector3){
    const point=new Vector3(),tangent=new Vector3();position.set(0,0,0);direction.set(0,0,0);
    for(const [offset,weight] of [[-window,.25],[0,.5],[window,.25]]){this.targetAhead(distance+offset,point,tangent);position.addScaledVector(point,weight);direction.addScaledVector(tangent,weight);}
    direction.normalize();
  }
  /** Project progress onto the current spline; crossing transitions remain topology constrained. */
  follow(position:Vector3,allowCrossing=true,corridor=1.5){
    const nearest=this.curve.nearest(position,true);this.at=Math.max(this.at,nearest.at);
    if(this.laneChange&&this.at>=this.laneChange.start+this.laneChange.length)this.laneChange=undefined;
    const end=this.curve.points.at(-1)!;
    if(allowCrossing&&this.curve.length-this.at<1&&Math.hypot(position.x-end.x,position.z-end.z)<corridor)this.moveDistance(this.curve.length-this.at+.01);
    if(this.laneChange)this.sampleLaneChange(this.at,this.position,this.direction);else this.curve.sample(this.at,this.position,this.direction);
  }
  get changingLane(){return !!this.laneChange;}
  get insideCrossing(){return !!this.crossingTurn;}
  get junctionExitDistance(){return !this.crossingTurn&&this.previousTurn?.outgoing===this.roadId?this.at:undefined;}
  /** Choose only an adjacent, parallel lane belonging to the same road branch. Body motion stays physical. */
  tryChangeLane(position:Vector3,length:number,isClear:(point:Vector3,direction:Vector3)=>boolean=()=>true){
    if(this.crossingTurn||this.laneChange||this.stopped||this.at<15||this.curve.length-this.at<length+20)return false;
    const road=this.network.others.find(road=>road.id===this.roadId);if(!road?.refs[0])return false;
    const sides=new Map<number,{id:number;curve:TrafficCurve;at:number;point:Vector3;direction:Vector3;gap:number}>();
    for(const other of this.network.others){
      if(other.id===this.roadId||other.refs[0]!==road.refs[0]||!this.connections.get(other.id)?.length)continue;
      const curve=this.curves.get(other.id)!,nearest=curve.nearest(position,true),point=new Vector3(),direction=new Vector3();curve.sample(nearest.at,point,direction);
      const delta=point.clone().sub(this.position),lateral=delta.x*this.direction.z-delta.z*this.direction.x,gap=Math.abs(lateral);
      if(gap<2||gap>5||Math.abs(delta.y)>1||Math.abs(delta.dot(this.direction))>2||direction.dot(this.direction)<.97||nearest.at<15||curve.length-nearest.at<length+20)continue;
      // Reject merging/diverging or crossing curves, even when their local tangents match.
      const ahead=new Vector3(),aheadDirection=new Vector3();curve.sample(nearest.at+length,ahead,aheadDirection);
      const sourceAhead=new Vector3(),sourceDirection=new Vector3();this.curve.sample(this.at+length,sourceAhead,sourceDirection);
      if(ahead.distanceTo(sourceAhead)>6||aheadDirection.dot(sourceDirection)<.97)continue;
      const side=Math.sign(lateral),previous=sides.get(side);
      if(!previous||gap<previous.gap)sides.set(side,{id:other.id,curve,at:nearest.at,point,direction,gap});
    }
    const choices=[...sides.values()].filter(lane=>isClear(lane.point,lane.direction));if(!choices.length)return false;
    const selected=choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))];
    this.laneChange={source:this.curve,start:selected.at,length};this.curve=selected.curve;this.at=selected.at;this.roadId=selected.id;this.pending=undefined;
    return true;
  }
  private sampleLaneChange(at:number,position:Vector3,direction:Vector3){
    const change=this.laneChange!;
    this.curve.sample(at,position,direction);
    const blend=(distance:number,out:Vector3)=>{
      this.curve.sample(distance,out,new Vector3());
      const source=new Vector3();change.source.sample(change.source.nearest(out,true).at,source,new Vector3());
      const t=Math.max(0,Math.min(1,(distance-change.start)/change.length)),weight=t*t*(3-2*t);
      out.lerp(source,1-weight);
    };
    blend(at,position);const ahead=new Vector3();blend(Math.min(this.curve.length,at+.1),ahead);direction.copy(ahead).sub(position).normalize();
  }
  get phase() { return this.crossingTurn ? `crossing #${this.crossingTurn.crossing}` : `road #${this.roadId}`; }
  get nextRoad() { return this.pending?.outgoing; }
  get approach(){
    if(this.crossingTurn)return;
    const crossing=this.connections.get(this.roadId)?.[0]?.crossing;if(crossing===undefined)return;
    return {road:this.roadId,crossing,remaining:this.curve.length-this.at,key:`${this.crossingsPassed}:${this.roadId}:${crossing}`};
  }
  private chooseTurn() {
    const turns = this.connections.get(this.roadId) ?? [];
    const branches = [...new Set(turns.map(turn => turn.branch))]; if (!branches.length) return;
    const pick = <T>(items: T[]) => items[Math.min(items.length - 1, Math.max(0, Math.floor(this.random() * items.length)))];
    const branch = pick(branches); return pick(turns.filter(turn => turn.branch === branch));
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.stopped) return;
    this.moveDistance(Math.min(seconds,.25)*this.speed);
  }
  private moveDistance(distance:number){
    let remaining=distance;
    for (let transition = 0; remaining > 0 && transition < 16; transition++) {
      if (!this.crossingTurn && !this.pending && this.curve.length - this.at <= 15) this.pending = this.chooseTurn();
      const step = Math.min(remaining, this.curve.length - this.at); this.at += step; remaining -= step; this.travelled += step;
      if (this.at < this.curve.length - 1e-8) break;
      if (this.crossingTurn) {
        this.previousTurn=this.crossingTurn;
        this.lastCrossingGroup=this.network.nodes.find(node=>node.id===this.crossingTurn!.crossing)?.group;
        this.roadId = this.crossingTurn.outgoing; this.curve = this.curves.get(this.roadId)!;
        this.crossingTurn = undefined; this.crossingsPassed++;
      } else {
        const turn = this.pending ?? this.chooseTurn(); this.pending = undefined;
        if (!turn) { this.stopped = true; break; }
        this.crossingTurn = turn; this.curve = crossingCurve(turn.segment);
      }
      this.at = 0;
    }
    this.curve.sample(this.at, this.position, this.direction);
  }
}

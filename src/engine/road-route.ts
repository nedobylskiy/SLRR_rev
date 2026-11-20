import {Vector3} from 'three';
import {sampleRoadSegment,type RoadNetwork,type RoadPath,type RoadPoint} from '../formats/trc';

interface Edge {id:number;from:number;to:number;points:Vector3[];distances:number[];length:number;roads:number[]}
interface Projection {edge:Edge;at:number;distance:number}
interface Anchor {node?:number;projection?:Projection;distance:number}
export interface StraightRaceCrossing {center:RoadPoint;radius:number;direction:RoadPoint}
export interface RoadRoute {length:number;direction:RoadPoint;roads:number[];points:RoadPoint[];straightCrossings?:StraightRaceCrossing[]}
const graphs=new WeakMap<RoadNetwork,RoadRoutes>();
const raceGraphs=new WeakMap<RoadNetwork,RoadRoutes>();
/** Racing permits either direction and any continuation at a crossing. */
export function raceRoadRoutes(network:RoadNetwork){let graph=raceGraphs.get(network);if(!graph){graph=new RoadRoutes(network,true);raceGraphs.set(network,graph);}return graph;}
export function roadRoutes(network:RoadNetwork){let graph=graphs.get(network);if(!graph){graph=new RoadRoutes(network);graphs.set(network,graph);}return graph;}
/** Host route queries use TRC street endpoints and lane-link directions, weighted by sampled metres.
 * This is a functional host implementation, not claimed binary parity with the original route solver. */
export class RoadRoutes {
  private edges:Edge[]=[];private outgoing=new Map<number,Edge[]>();
  private trees=new Map<number,{distance:Map<number,number>;previous:Map<number,Edge>}>();
  private cells=new Map<string,{edge:Edge;segment:number}[]>();
  private nodes=new Map<number,Vector3>();private radii=new Map<number,number>();
  constructor(readonly network:RoadNetwork,private racing=false){
    for(const node of network.nodes)this.nodes.set(node.id,new Vector3(...node.position));
    const add=(path:RoadPath,from:number,to:number,roads:number[])=>{
      const a=this.nodes.get(from),b=this.nodes.get(to);if(!a||!b||from===to)return;
      let samples:Vector3[]=[];
      for(const segment of path.segments){const steps=Math.max(8,Math.min(512,Math.ceil(segment.length/2)));for(let i=0;i<=steps;i++)samples.push(new Vector3(...sampleRoadSegment(segment,i/steps)));}
      if(samples.length<2)return;
      if(samples[0].distanceToSquared(a)+samples.at(-1)!.distanceToSquared(b)>samples[0].distanceToSquared(b)+samples.at(-1)!.distanceToSquared(a))samples.reverse();
      for(const [node,d]of [[from,samples[0].distanceTo(a)],[to,samples.at(-1)!.distanceTo(b)]])this.radii.set(node,Math.min(this.radii.get(node)??Infinity,d));
      samples=[a,...samples,b];const points:Vector3[]=[],distances:number[]=[];let length=0;
      for(const point of samples){const d=points.at(-1)?.distanceTo(point)??0;if(points.length&&d<1e-7)continue;length+=d;points.push(point);distances.push(length);}
      if(length<1e-6)return;
      const edge={id:path.id,from,to,points,distances,length,roads};this.edges.push(edge);
      const list=this.outgoing.get(from)??[];list.push(edge);this.outgoing.set(from,list);
      for(let segment=1;segment<points.length;segment++){
        const p=points[segment-1],q=points[segment],x0=Math.floor(Math.min(p.x,q.x)/64),x1=Math.floor(Math.max(p.x,q.x)/64),z0=Math.floor(Math.min(p.z,q.z)/64),z1=Math.floor(Math.max(p.z,q.z)/64);
        for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=`${x},${z}`,cell=this.cells.get(key)??[];cell.push({edge,segment});this.cells.set(key,cell);}
      }
    };
    // A path is a street centreline, not necessarily a one-way edge. Its lanes
    // can run both ways; only crossing link flags establish legal travel direction.
    const departures=new Map<number,Set<number>>(),arrivals=new Map<number,Set<number>>();
    for(const node of network.nodes)for(const link of node.links){const map=link.flag===0?departures:arrivals,ids=map.get(node.id)??new Set();ids.add(link.target);map.set(node.id,ids);}
    for(const path of network.paths){
      const roads=network.others.filter(r=>r.refs[0]===path.id),a=path.refs[1],b=path.refs[2];
      if(racing){
        // Use actual lane curves, not a straight chord to the finish. All lanes
        // meet at the crossing, so a turn-only traffic lane cannot force a racer
        // into a detour when another lane continues straight.
        for(const lane of roads.length?roads:[path])for(const [from,to]of [[a,b],[b,a]])
          add(lane,from,to,roads.length?[lane.id]:[]);
        continue;
      }
      for(const [from,to]of [[a,b],[b,a]]){
        const lanes=roads.filter(r=>departures.get(from)?.has(r.id)&&arrivals.get(to)?.has(r.id));
        if(lanes.length)add(path,from,to,lanes.map(r=>r.id));
      }
      // Geometry-only graphs without any lane records retain their explicit endpoints.
      if(!roads.length)add(path,a,b,[]);
    }
    if(!this.edges.length)for(const road of network.others){
      const from=network.nodes.find(n=>n.links.some(l=>l.target===road.id&&l.flag===0)),to=network.nodes.find(n=>n.links.some(l=>l.target===road.id&&l.flag!==0));
      if(from&&to){add(road,from.id,to.id,[road.id]);if(racing)add(road,to.id,from.id,[road.id]);}
    }
  }
  private project(point:Vector3,edges?:Edge[]):Projection|undefined {
    let best:Projection|undefined;
    const delta=new Vector3(),nearest=new Vector3();
    const visit=({edge,segment}:{edge:Edge;segment:number})=>{
      const a=edge.points[segment-1],b=edge.points[segment];delta.copy(b).sub(a);
      const t=Math.max(0,Math.min(1,nearest.copy(point).sub(a).dot(delta)/delta.lengthSq()));nearest.copy(a).addScaledVector(delta,t);
      const distance=point.distanceTo(nearest);if(!best||distance<best.distance)best={edge,at:edge.distances[segment-1]+t*(edge.distances[segment]-edge.distances[segment-1]),distance};
    };
    if(edges){for(const edge of edges)for(let segment=1;segment<edge.points.length;segment++)visit({edge,segment});return best;}
    const cx=Math.floor(point.x/64),cz=Math.floor(point.z/64);
    for(let ring=0;ring<4;ring++){
      for(let x=cx-ring;x<=cx+ring;x++)for(let z=cz-ring;z<=cz+ring;z++)if(ring===0||x===cx-ring||x===cx+ring||z===cz-ring||z===cz+ring)for(const item of this.cells.get(`${x},${z}`)??[])visit(item);
      const boundary=Math.min(point.x-(cx-ring)*64,(cx+ring+1)*64-point.x,point.z-(cz-ring)*64,(cz+ring+1)*64-point.z);
      if(best&&best.distance<boundary)return best;
    }
    for(const edge of this.edges)for(let segment=1;segment<edge.points.length;segment++)visit({edge,segment});return best;
  }
  /** Nearest sampled street position and its local travel tangent, including elevation. */
  align(point:RoadPoint):{position:RoadPoint;direction:RoadPoint}|undefined {
    if(!point.every(Number.isFinite))return;
    const projection=this.project(new Vector3(...point));if(!projection)return;
    const {edge,at}=projection;let end=1;
    while(end<edge.points.length-1&&edge.distances[end]<=at+1e-7)end++;
    const a=edge.points[end-1],b=edge.points[end],span=edge.distances[end]-edge.distances[end-1];
    return {position:a.clone().lerp(b,Math.max(0,Math.min(1,(at-edge.distances[end-1])/span))).toArray(),direction:b.clone().sub(a).normalize().toArray()};
  }
  private anchor(point:Vector3):Anchor|undefined {
    let node:number|undefined,distance=Infinity;
    for(const [id,p]of this.nodes){const d=p.distanceTo(point);if(d<distance){node=id;distance=d;}}
    if(node!==undefined&&distance<=Math.max(3,Math.min(15,(this.radii.get(node)??0)+1)))return {node,distance};
    const projection=this.project(point);return projection?{projection,distance:projection.distance}:undefined;
  }
  private tree(source:number){
    let tree=this.trees.get(source);if(tree)return tree;
    const distance=new Map<number,number>([[source,0]]),previous=new Map<number,Edge>(),open=new Set([source]);
    while(open.size){let current=-1,best=Infinity;for(const id of open){const d=distance.get(id)!;if(d<best){best=d;current=id;}}open.delete(current);
      for(const edge of this.outgoing.get(current)??[]){const d=best+edge.length;if(d<(distance.get(edge.to)??Infinity)){distance.set(edge.to,d);previous.set(edge.to,edge);open.add(edge.to);}}
    }
    tree={distance,previous};if(this.trees.size>=64)this.trees.delete(this.trees.keys().next().value!);this.trees.set(source,tree);return tree;
  }
  query(start:RoadPoint,finish:RoadPoint,occupied:RoadPoint[]=[]):RoadRoute|undefined {
    if(![...start,...finish].every(Number.isFinite)||!this.edges.length)return;
    if(start.every((v,i)=>Math.abs(v-finish[i])<1e-8))return {length:0,direction:[0,0,0],roads:[],points:[[...start]]};
    const s=new Vector3(...start),f=new Vector3(...finish),a=this.anchor(s),b=this.anchor(f);if(!a||!b)return;
    const choices=(anchor:Anchor):Anchor[]=>{
      const p=anchor.projection;if(!p)return [anchor];
      if(this.racing){
        const candidates=this.edges.filter(e=>e.from===p.edge.from&&e.to===p.edge.to||e.from===p.edge.to&&e.to===p.edge.from);
        return candidates.map(edge=>this.project(anchor===a?s:f,[edge])!).filter(p=>p.distance<=anchor.distance+12)
          .map(projection=>({projection,distance:projection.distance}));
      }
      const reverse=this.edges.find(e=>e.id===p.edge.id&&e.from===p.edge.to&&e.to===p.edge.from);
      return reverse?[anchor,{projection:{edge:reverse,at:reverse.length-p.at,distance:p.distance},distance:anchor.distance}]:[anchor];
    };
    const blocked=new Set<number>();
    if(this.racing)for(const point of occupied){const p=this.project(new Vector3(...point));if(p&&p.distance<2.5)for(const id of p.edge.roads)blocked.add(id);}
    let best:RoadRoute|undefined,bestCost=Infinity;
    for(const from of choices(a))for(const to of choices(b)){
      const route=this.between(s,f,from,to);if(!route)continue;
      const cost=route.length+route.roads.filter(id=>blocked.has(id)).length*40;
      if(cost<bestCost){best=route;bestCost=cost;}
    }
    return best;
  }
  private between(s:Vector3,f:Vector3,a:Anchor,b:Anchor):RoadRoute|undefined {
    const source=a.node??a.projection!.edge.to,target=b.node??b.projection!.edge.from,tree=this.tree(source);
    const middle=tree.distance.get(target)??Infinity;
    let length=(a.projection?a.projection.edge.length-a.projection.at:0)+middle+(b.projection?b.projection.at:0),edges:Edge[]=[];
    const same=a.projection&&b.projection&&a.projection.edge===b.projection.edge&&b.projection.at>=a.projection.at;
    if(same&&b.projection!.at-a.projection!.at<=length){length=b.projection!.at-a.projection!.at;edges=[a.projection!.edge];}
    else {if(!Number.isFinite(length))return;let id=target;while(id!==source){const edge=tree.previous.get(id);if(!edge)return;edges.unshift(edge);id=edge.from;}if(a.projection)edges.unshift(a.projection.edge);if(b.projection)edges.push(b.projection.edge);}
    const points:Vector3[]=[s],push=(p:Vector3)=>{if(points.at(-1)!.distanceToSquared(p)>1e-12)points.push(p);};
    for(let i=0;i<edges.length;i++){const edge=edges[i],lo=i===0&&a.projection?a.projection.at:0,hi=i===edges.length-1&&b.projection?b.projection.at:edge.length;
      const at=(d:number)=>{let n=1;while(n<edge.distances.length-1&&edge.distances[n]<d)n++;return edge.points[n-1].clone().lerp(edge.points[n],(d-edge.distances[n-1])/(edge.distances[n]-edge.distances[n-1]));};
      push(at(lo));for(let j=1;j<edge.points.length;j++)if(edge.distances[j]>lo&&edge.distances[j]<hi)push(edge.points[j]);push(at(hi));
    }
    push(f);let direction=(points[1]?.clone().sub(s)??new Vector3()).normalize();
    if(edges.length){const edge=edges[0],at=a.projection?.at??0;let i=1;while(i<edge.distances.length-1&&edge.distances[i]<=at+1e-7)i++;direction=edge.points[i].clone().sub(edge.points[i-1]).normalize();}
    const straightCrossings:StraightRaceCrossing[]=[];
    if(this.racing)for(let i=1;i<edges.length;i++){
      const incoming=edges[i-1],outgoing=edges[i];if(incoming.to!==outgoing.from)continue;
      // Ignore the artificial connector to the crossing centre: compare the
      // actual approach/exit tangents to identify straight travel geometrically.
      const a=incoming.points,b=outgoing.points;
      if(a.length<4||b.length<4)continue;
      const entry=a[a.length-2].clone().sub(a[a.length-3]).setY(0).normalize();
      const exit=b[2].clone().sub(b[1]).setY(0).normalize();
      if(entry.dot(exit)<Math.cos(Math.PI/9))continue;
      const center=this.nodes.get(incoming.to)!;
      const crossing=this.network.nodes.find(node=>node.id===incoming.to);
      const laneExtent=Math.max(0,...(crossing?.lanes??[]).flatMap(lane=>[lane.segment.start,lane.segment.end].map(p=>Math.hypot(p[0]-center.x,p[2]-center.z))));
      straightCrossings.push({center:center.toArray(),radius:Math.max(5,Math.min(60,laneExtent),center.distanceTo(a[a.length-2]),center.distanceTo(b[1]))+1,direction:entry.toArray()});
    }
    return {length:length+a.distance+b.distance,direction:direction.toArray(),roads:[...new Set(edges.flatMap(e=>e.roads))],points:points.map(p=>p.toArray()),...(this.racing?{straightCrossings}: {})};
  }
  /** Race exclusion covers both directions between the traversed crossings. */
  haltRoads(route:RoadRoute){const selected=new Set(route.roads),pairs=new Set(this.edges.filter(e=>e.roads.some(id=>selected.has(id))).map(e=>`${Math.min(e.from,e.to)}:${Math.max(e.from,e.to)}`));
    for(const edge of this.edges)if(pairs.has(`${Math.min(edge.from,edge.to)}:${Math.max(edge.from,edge.to)}`))for(const id of edge.roads)selected.add(id);return [...selected];}
}

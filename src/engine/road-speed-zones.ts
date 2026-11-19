import {sampleRoadSegment,type RoadNetwork,type RoadPoint,type RoadSegment} from '../formats/trc';
import {trafficRoadSpeedGroups,trafficSpeedBand} from './road-traffic';

type Span={a:RoadPoint;b:RoadPoint;group:0|1};
const CELL=64,RADIUS=30;
const indices=new WeakMap<RoadNetwork,RoadSpeedZones>();
export function roadSpeedZones(network:RoadNetwork){let index=indices.get(network);if(!index){index=new RoadSpeedZones(network);indices.set(network,index);}return index;}

/** Host approximation of speed zones using existing road groups, including junction lanes.
 * Indexed once per graph; full 3D projection distinguishes stacked roads. */
class RoadSpeedZones {
  private cells=new Map<string,Span[]>();
  constructor(network:RoadNetwork){
    const add=(segment:RoadSegment,group:0|1)=>{
      const steps=Math.max(1,Math.ceil(segment.length/5));let a=sampleRoadSegment(segment,0);
      for(let i=1;i<=steps;i++){
        const b=sampleRoadSegment(segment,i/steps),span={a,b,group};
        for(let x=Math.floor((Math.min(a[0],b[0])-RADIUS)/CELL);x<=Math.floor((Math.max(a[0],b[0])+RADIUS)/CELL);x++)
          for(let z=Math.floor((Math.min(a[2],b[2])-RADIUS)/CELL);z<=Math.floor((Math.max(a[2],b[2])+RADIUS)/CELL);z++){
            const key=`${x},${z}`,cell=this.cells.get(key)??[];cell.push(span);this.cells.set(key,cell);
          }
        a=b;
      }
    };
    const groups=trafficRoadSpeedGroups(network);
    for(const road of network.others){const group=groups.get(road.id);if(group!==undefined)for(const segment of road.segments)add(segment,group);}
    for(const node of network.nodes)for(const lane of node.lanes)add(lane.segment,node.group);
  }
  limit(position:{x:number;y:number;z:number}){
    const {x,y,z}=position;if(![x,y,z].every(Number.isFinite))return -1;
    let best=RADIUS*RADIUS,group:0|1|undefined;
    for(const span of this.cells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]){
      const [ax,ay,az]=span.a,dx=span.b[0]-ax,dy=span.b[1]-ay,dz=span.b[2]-az;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/(dx*dx+dy*dy+dz*dz||1)));
      const distance=(x-ax-t*dx)**2+(y-ay-t*dy)**2+(z-az-t*dz)**2;
      if(distance<best){best=distance;group=span.group;}
    }
    return group===undefined?-1:trafficSpeedBand(group)[1]/3.6;
  }
}

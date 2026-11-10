import {BufferGeometry,Color,Float32BufferAttribute,Group,LineBasicMaterial,LineSegments,type Object3D} from 'three';
import type {PedestrianRecord,PedestrianRest,PedestrianWalk} from '../formats/pedestrian';
export type PedestrianDebugLayer='graph'|'rest';
/** Debug records are independent of scenery streaming and do not cast shadows. */
export class MapPedestrianDebug {
  readonly root=new Group();readonly graph=new Group();readonly rest=new Group();
  constructor(parent:Object3D,walk:PedestrianWalk[],rest:PedestrianRest[]){
    this.root.name='Pedestrian AI debug';this.root.add(this.graph,this.rest);parent.add(this.root);this.graph.visible=this.rest.visible=false;
    const points:number[]=[],colors:number[]=[],tint=new Color();
    const line=(a:number[],b:number[],color:number)=>{points.push(a[0],a[1]+.15,a[2],b[0],b[1]+.15,b[2]);tint.setHex(color);for(let i=0;i<2;i++)colors.push(tint.r,tint.g,tint.b);};
    for(const row of walk){
      const y=(row.box[1]+row.box[4])/2;
      const visit=(record:PedestrianRecord)=>{
        if(record.points)for(let i=1;i<record.points.length;i++)line(record.points[i-1],record.points[i],0x39e6d2);
        else if(record.quad)line([record.quad[0],y,record.quad[1]],[record.quad[2],y,record.quad[3]],record.kind===21?0xffdf62:0x679cff);
        if(record.child)visit(record.child);
      };row.records.forEach(visit);
    }
    this.addLines(this.graph,points,colors);
    const boxPoints:number[]=[],boxColors:number[]=[];
    for(const box of rest){const b=box.box;tint.setHex([0,0xc889ff,0xffa652,0x86e66e][box.area]??0xffffff);
      const corners=Array.from({length:8},(_,i)=>[b[i&1?3:0],b[i&2?4:1]+.1,b[i&4?5:2]]);
      for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){boxPoints.push(...corners[i],...corners[i|bit]);for(let v=0;v<2;v++)boxColors.push(tint.r,tint.g,tint.b);}
    }
    this.addLines(this.rest,boxPoints,boxColors);
  }
  private addLines(parent:Group,points:number[],colors:number[]){const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));const lines=new LineSegments(geometry,new LineBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false,fog:false,toneMapped:false,transparent:true,opacity:.7}));lines.renderOrder=22;parent.add(lines);}
  show(layer:PedestrianDebugLayer,visible:boolean){this[layer].visible=visible;}
  dispose(){this.root.removeFromParent();this.root.traverse(object=>{if(object instanceof LineSegments){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}});}
}

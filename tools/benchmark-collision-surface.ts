import {Vector3} from 'three';
import {TriangleSurface} from '../src/engine/triangle-surface';
const all:number[]=[];const size=80,parts=16;
for(let z=0;z<size;z++)for(let x=0;x<size;x++){
  const xx=x/20-2,zz=z/20-2,y=.1*Math.sin(x*.3)+.05*Math.cos(z*.2),step=.05;
  all.push(xx,y,zz,xx+step,y,zz,xx+step,y,zz+step,xx,y,zz,xx+step,y,zz+step,xx,y,zz+step);
}
const perPart=all.length/parts;
const create=(data:number[])=>new TriangleSurface(data,()=>true,()=>new Vector3(),()=>{});
const run=(mode:number)=>{
  let surface=create(all),total=0;let builds=0,refits=0;
  for(let removed=1;removed<parts;removed++){
    const start=performance.now();
    if(mode){const coords=all.slice();coords.fill(0,all.length-removed*perPart);surface.refit(coords,mode===2?[{start:all.length-removed*perPart,count:perPart}]:undefined);refits++;}
    else{surface=create(all.slice(0,all.length-removed*perPart));builds++;}
    total+=performance.now()-start;
  }
  return {total,builds,refits,surface};
};
run(0);run(1);run(2);
for(const mode of [0,1,2]){
  const times:number[]=[];let work;
  for(let i=0;i<5;i++){work=run(mode);times.push(work.total);}
  times.sort((a,b)=>a-b);
  console.log(JSON.stringify({mode:['rebuild after detachment','stable slots + full refit','stable slots + partial refit'][mode],original_triangles:all.length/9,detachments:parts-1,builds:work!.builds,refits:work!.refits,median_ms:times[2]}));
}
